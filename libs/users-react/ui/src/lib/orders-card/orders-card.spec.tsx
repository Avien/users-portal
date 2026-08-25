import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Order } from '@portal/users/utils';
import { OrdersCard } from './orders-card';

const orders: Order[] = [
  { id: 1, userId: 1, total: 10, status: 'completed' },
  { id: 2, userId: 1, total: 20, status: 'completed' },
];

// jsdom has no layout engine — offsetWidth/offsetHeight are always 0, which
// makes @tanstack/react-virtual compute a zero-size viewport (no ResizeObserver
// in jsdom either) and render no rows at all regardless of `orders`. Give the
// scroll container a real size so the virtualizer renders its items.
let offsetHeightSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  offsetHeightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(416);
});
afterAll(() => {
  offsetHeightSpy.mockRestore();
});

// jsdom does not implement Element.prototype.scrollTo at all — the
// virtualizer's scrollToIndex() calls it directly to perform the actual
// scroll. Stub it so it doesn't throw, and so tests can assert on it.
let scrollToSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  scrollToSpy = vi.fn();
  HTMLElement.prototype.scrollTo = scrollToSpy;
});

const baseProps = { loading: false, loaded: true, error: null, selectedUserId: 1 };

describe('OrdersCard — live order feedback', () => {
  it('does not mark any row as new when recentlyArrivedOrderIds is empty', () => {
    render(<OrdersCard {...baseProps} orders={orders} recentlyArrivedOrderIds={new Set()} />);
    const rowOne = screen.getByText('#1').closest('[role="listitem"]') as HTMLElement;
    const rowTwo = screen.getByText('#2').closest('[role="listitem"]') as HTMLElement;
    expect(rowOne.className).toBe('');
    expect(rowTwo.className).toBe('');
  });

  it('marks only the row matching a recently-arrived order id', () => {
    render(<OrdersCard {...baseProps} orders={orders} recentlyArrivedOrderIds={new Set([2])} />);
    const rowOne = screen.getByText('#1').closest('[role="listitem"]') as HTMLElement;
    const rowTwo = screen.getByText('#2').closest('[role="listitem"]') as HTMLElement;
    expect(rowOne.className).toBe('');
    expect(rowTwo.className).not.toBe('');
  });

  it('marks multiple concurrently-arrived rows', () => {
    render(<OrdersCard {...baseProps} orders={orders} recentlyArrivedOrderIds={new Set([1, 2])} />);
    const rowOne = screen.getByText('#1').closest('[role="listitem"]') as HTMLElement;
    const rowTwo = screen.getByText('#2').closest('[role="listitem"]') as HTMLElement;
    expect(rowOne.className).not.toBe('');
    expect(rowTwo.className).not.toBe('');
  });
});

describe('OrdersCard — smart live-follow', () => {
  function setScrollGeometry(el: HTMLElement, { scrollHeight, clientHeight, scrollTop }: {
    scrollHeight: number;
    clientHeight: number;
    scrollTop: number;
  }) {
    Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
    Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true, writable: true });
  }

  it('auto-scrolls to the last row when a new order arrives for the selected user while at the bottom', () => {
    const { rerender } = render(
      <OrdersCard {...baseProps} orders={[orders[0]]} recentlyArrivedOrderIds={new Set()} />
    );
    scrollToSpy.mockClear();

    rerender(<OrdersCard {...baseProps} orders={orders} recentlyArrivedOrderIds={new Set([2])} />);

    expect(scrollToSpy).toHaveBeenCalled();
  });

  it('the newest row carries the highlight class once it scrolls into view', () => {
    const { rerender } = render(
      <OrdersCard {...baseProps} orders={[orders[0]]} recentlyArrivedOrderIds={new Set()} />
    );
    rerender(<OrdersCard {...baseProps} orders={orders} recentlyArrivedOrderIds={new Set([2])} />);

    const rowTwo = screen.getByText('#2').closest('[role="listitem"]') as HTMLElement;
    expect(rowTwo.className).not.toBe('');
  });

  it('does not auto-scroll on HTTP hydration (orders growing without a matching recentlyArrivedOrderIds entry)', () => {
    const { rerender } = render(
      <OrdersCard {...baseProps} orders={[orders[0]]} recentlyArrivedOrderIds={new Set()} />
    );
    scrollToSpy.mockClear();

    rerender(<OrdersCard {...baseProps} orders={orders} recentlyArrivedOrderIds={new Set()} />);

    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it('does not force-scroll when the user has scrolled away from the bottom, and bumps the pending count instead', () => {
    const { rerender } = render(
      <OrdersCard {...baseProps} orders={[orders[0]]} recentlyArrivedOrderIds={new Set()} />
    );
    const scrollEl = screen.getByRole('list');
    setScrollGeometry(scrollEl, { scrollHeight: 1000, clientHeight: 416, scrollTop: 0 });
    fireEvent.scroll(scrollEl);

    scrollToSpy.mockClear();
    rerender(<OrdersCard {...baseProps} orders={orders} recentlyArrivedOrderIds={new Set([2])} />);

    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(screen.getByText('+1 new order ↓')).toBeTruthy();
  });

  it('increments the pending count cleanly across multiple arrivals while paused', () => {
    const { rerender } = render(
      <OrdersCard {...baseProps} orders={[orders[0]]} recentlyArrivedOrderIds={new Set()} />
    );
    const scrollEl = screen.getByRole('list');
    setScrollGeometry(scrollEl, { scrollHeight: 1000, clientHeight: 416, scrollTop: 0 });
    fireEvent.scroll(scrollEl);

    rerender(<OrdersCard {...baseProps} orders={orders} recentlyArrivedOrderIds={new Set([2])} />);
    const order3: Order = { id: 3, userId: 1, total: 5, status: 'pending' };
    rerender(
      <OrdersCard {...baseProps} orders={[...orders, order3]} recentlyArrivedOrderIds={new Set([2, 3])} />
    );

    expect(screen.getByText('+2 new orders ↓')).toBeTruthy();
  });

  it('clicking the indicator scrolls to the latest row, clears the pending count, and resumes live-follow', () => {
    const { rerender } = render(
      <OrdersCard {...baseProps} orders={[orders[0]]} recentlyArrivedOrderIds={new Set()} />
    );
    const scrollEl = screen.getByRole('list');
    setScrollGeometry(scrollEl, { scrollHeight: 1000, clientHeight: 416, scrollTop: 0 });
    fireEvent.scroll(scrollEl);

    rerender(<OrdersCard {...baseProps} orders={orders} recentlyArrivedOrderIds={new Set([2])} />);
    expect(screen.getByText('+1 new order ↓')).toBeTruthy();

    scrollToSpy.mockClear();
    fireEvent.click(screen.getByText('+1 new order ↓'));

    expect(scrollToSpy).toHaveBeenCalled();
    expect(screen.queryByText(/new order/)).toBeNull();
  });

  it('returning manually to the bottom resumes live-follow and clears the pending indicator', () => {
    const { rerender } = render(
      <OrdersCard {...baseProps} orders={[orders[0]]} recentlyArrivedOrderIds={new Set()} />
    );
    const scrollEl = screen.getByRole('list');
    setScrollGeometry(scrollEl, { scrollHeight: 1000, clientHeight: 416, scrollTop: 0 });
    fireEvent.scroll(scrollEl); // away from bottom

    rerender(<OrdersCard {...baseProps} orders={orders} recentlyArrivedOrderIds={new Set([2])} />);
    expect(screen.getByText('+1 new order ↓')).toBeTruthy();

    setScrollGeometry(scrollEl, { scrollHeight: 1000, clientHeight: 416, scrollTop: 1000 - 416 }); // back near bottom
    fireEvent.scroll(scrollEl);

    expect(screen.queryByText(/new order/)).toBeNull();
  });

  it('resets live-follow/pending state when the selected user changes', () => {
    const { rerender } = render(
      <OrdersCard {...baseProps} orders={[orders[0]]} recentlyArrivedOrderIds={new Set()} />
    );
    const scrollEl = screen.getByRole('list');
    setScrollGeometry(scrollEl, { scrollHeight: 1000, clientHeight: 416, scrollTop: 0 });
    fireEvent.scroll(scrollEl);
    rerender(<OrdersCard {...baseProps} orders={orders} recentlyArrivedOrderIds={new Set([2])} />);
    expect(screen.getByText('+1 new order ↓')).toBeTruthy();

    rerender(
      <OrdersCard {...baseProps} selectedUserId={2} orders={[]} recentlyArrivedOrderIds={new Set()} loaded={true} />
    );

    expect(screen.queryByText(/new order/)).toBeNull();
  });
});

describe('OrdersCard — stable viewport height', () => {
  it('reserves the same height across loading, loaded-empty, and rendered-list states', () => {
    const { rerender } = render(
      <OrdersCard orders={[]} loading={true} loaded={false} error={null} recentlyArrivedOrderIds={new Set()} selectedUserId={1} />
    );
    const wrapper = screen.getByTestId('orders-viewport');
    expect(wrapper.style.height).toBe('416px');
    expect(screen.getByText('Loading orders...')).toBeTruthy();

    rerender(
      <OrdersCard orders={[]} loading={false} loaded={true} error={null} recentlyArrivedOrderIds={new Set()} selectedUserId={1} />
    );
    expect(wrapper.style.height).toBe('416px');
    expect(screen.getByText('No orders for this user.')).toBeTruthy();

    rerender(
      <OrdersCard orders={orders} loading={false} loaded={true} error={null} recentlyArrivedOrderIds={new Set()} selectedUserId={1} />
    );
    expect(wrapper.style.height).toBe('416px');
  });
});
