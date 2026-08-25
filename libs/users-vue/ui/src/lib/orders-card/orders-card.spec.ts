import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import OrdersCard from './orders-card.vue';
import { MOCK_ORDERS } from '@portal/users/utils';

const base = {
  orders: [],
  loading: false,
  loaded: false,
  error: null,
  recentlyArrivedOrderIds: new Set<number>(),
  selectedUserId: 1,
};

describe('OrdersCard', () => {
  it('shows the error message when error is set', () => {
    const wrapper = mount(OrdersCard, { props: { ...base, error: 'Network failed' } });
    expect(wrapper.find('.error').text()).toBe('Network failed');
  });

  it('shows a loading message while loading', () => {
    const wrapper = mount(OrdersCard, { props: { ...base, loading: true } });
    expect(wrapper.find('.muted').text()).toContain('Loading');
  });

  it('shows the empty state when loaded with no orders', () => {
    const wrapper = mount(OrdersCard, { props: { ...base, loaded: true } });
    expect(wrapper.find('.muted').text()).toContain('No orders');
  });

  it('renders the scrollable orders list when orders exist', () => {
    const wrapper = mount(OrdersCard, {
      props: { ...base, orders: MOCK_ORDERS.slice(0, 3), loaded: true },
    });
    expect(wrapper.find('[role="list"]').exists()).toBe(true);
  });

  describe('live order feedback', () => {
    // jsdom has no layout engine — offsetWidth/offsetHeight are always 0,
    // which makes @tanstack/vue-virtual compute a zero-size viewport (no
    // ResizeObserver in jsdom either) and render no rows at all regardless
    // of `orders`. Give the scroll container a real size so it renders.
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

    const orders = MOCK_ORDERS.slice(0, 2);

    // @tanstack/vue-virtual's own onMounted measurement runs one tick after
    // Vue Test Utils' synchronous mount() — the rows aren't in the DOM yet
    // on the same tick, even with offsetHeight mocked above.
    async function flushVirtualizer() {
      await nextTick();
      await nextTick();
    }

    it('does not mark any row as new when recentlyArrivedOrderIds is empty', async () => {
      const wrapper = mount(OrdersCard, { props: { ...base, orders, loaded: true } });
      await flushVirtualizer();
      const rows = wrapper.findAll('[role="listitem"]');
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => !row.classes().includes('row--new'))).toBe(true);
    });

    it('marks only the row matching a recently-arrived order id', async () => {
      const wrapper = mount(OrdersCard, {
        props: { ...base, orders, loaded: true, recentlyArrivedOrderIds: new Set([orders[1].id]) },
      });
      await flushVirtualizer();
      const rows = wrapper.findAll('[role="listitem"]');
      expect(rows[0].classes()).not.toContain('row--new');
      expect(rows[1].classes()).toContain('row--new');
    });

    it('marks multiple concurrently-arrived rows', async () => {
      const wrapper = mount(OrdersCard, {
        props: {
          ...base,
          orders,
          loaded: true,
          recentlyArrivedOrderIds: new Set([orders[0].id, orders[1].id]),
        },
      });
      await flushVirtualizer();
      const rows = wrapper.findAll('[role="listitem"]');
      expect(rows[0].classes()).toContain('row--new');
      expect(rows[1].classes()).toContain('row--new');
    });
  });

  describe('smart live-follow', () => {
    let offsetHeightSpy: ReturnType<typeof vi.spyOn>;
    beforeAll(() => {
      offsetHeightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(416);
    });
    afterAll(() => {
      offsetHeightSpy.mockRestore();
    });

    let scrollToSpy: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      scrollToSpy = vi.fn();
      HTMLElement.prototype.scrollTo = scrollToSpy;
    });

    async function flushVirtualizer() {
      await nextTick();
      await nextTick();
      await nextTick();
    }

    const order101 = MOCK_ORDERS[0]; // { id: 101, userId: 1, ... }
    const order102 = MOCK_ORDERS[1]; // { id: 102, userId: 1, ... }
    const order103 = { id: 103, userId: 1, total: 5, status: 'pending' as const };

    function setScrollGeometry(
      el: HTMLElement,
      { scrollHeight, clientHeight, scrollTop }: { scrollHeight: number; clientHeight: number; scrollTop: number }
    ) {
      Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
      Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
      Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true, writable: true });
    }

    it('auto-scrolls to the last row when a new order arrives for the selected user while at the bottom', async () => {
      const wrapper = mount(OrdersCard, {
        props: { ...base, orders: [order101], loaded: true, recentlyArrivedOrderIds: new Set() },
      });
      await flushVirtualizer();
      scrollToSpy.mockClear();

      await wrapper.setProps({ orders: [order101, order102], recentlyArrivedOrderIds: new Set([102]) });
      await flushVirtualizer();

      expect(scrollToSpy).toHaveBeenCalled();
    });

    it('the newest row carries the highlight class once it scrolls into view', async () => {
      const wrapper = mount(OrdersCard, {
        props: { ...base, orders: [order101], loaded: true, recentlyArrivedOrderIds: new Set() },
      });
      await flushVirtualizer();

      await wrapper.setProps({ orders: [order101, order102], recentlyArrivedOrderIds: new Set([102]) });
      await flushVirtualizer();

      const rows = wrapper.findAll('[role="listitem"]');
      const newRow = rows.find((row) => row.text().includes('102'));
      expect(newRow?.classes()).toContain('row--new');
    });

    it('does not auto-scroll on HTTP hydration (orders growing without a matching recentlyArrivedOrderIds entry)', async () => {
      const wrapper = mount(OrdersCard, {
        props: { ...base, orders: [order101], loaded: true, recentlyArrivedOrderIds: new Set() },
      });
      await flushVirtualizer();
      scrollToSpy.mockClear();

      await wrapper.setProps({ orders: [order101, order102] }); // no recentlyArrivedOrderIds change
      await flushVirtualizer();

      expect(scrollToSpy).not.toHaveBeenCalled();
    });

    it('does not force-scroll when the user has scrolled away from the bottom, and bumps the pending count instead', async () => {
      const wrapper = mount(OrdersCard, {
        props: { ...base, orders: [order101], loaded: true, recentlyArrivedOrderIds: new Set() },
      });
      await flushVirtualizer();

      const scrollEl = wrapper.find('[role="list"]').element as HTMLElement;
      setScrollGeometry(scrollEl, { scrollHeight: 1000, clientHeight: 416, scrollTop: 0 });
      await wrapper.find('[role="list"]').trigger('scroll');

      scrollToSpy.mockClear();
      await wrapper.setProps({ orders: [order101, order102], recentlyArrivedOrderIds: new Set([102]) });
      await flushVirtualizer();

      expect(scrollToSpy).not.toHaveBeenCalled();
      expect(wrapper.find('.new-orders-indicator').text()).toContain('+1 new order');
    });

    it('increments the pending count cleanly across multiple arrivals while paused', async () => {
      const wrapper = mount(OrdersCard, {
        props: { ...base, orders: [order101], loaded: true, recentlyArrivedOrderIds: new Set() },
      });
      await flushVirtualizer();

      const scrollEl = wrapper.find('[role="list"]').element as HTMLElement;
      setScrollGeometry(scrollEl, { scrollHeight: 1000, clientHeight: 416, scrollTop: 0 });
      await wrapper.find('[role="list"]').trigger('scroll');

      await wrapper.setProps({ orders: [order101, order102], recentlyArrivedOrderIds: new Set([102]) });
      await flushVirtualizer();
      await wrapper.setProps({
        orders: [order101, order102, order103],
        recentlyArrivedOrderIds: new Set([102, 103]),
      });
      await flushVirtualizer();

      expect(wrapper.find('.new-orders-indicator').text()).toContain('+2 new orders');
    });

    it('clicking the indicator scrolls to the latest row, clears the pending count, and resumes live-follow', async () => {
      const wrapper = mount(OrdersCard, {
        props: { ...base, orders: [order101], loaded: true, recentlyArrivedOrderIds: new Set() },
      });
      await flushVirtualizer();

      const scrollEl = wrapper.find('[role="list"]').element as HTMLElement;
      setScrollGeometry(scrollEl, { scrollHeight: 1000, clientHeight: 416, scrollTop: 0 });
      await wrapper.find('[role="list"]').trigger('scroll');

      await wrapper.setProps({ orders: [order101, order102], recentlyArrivedOrderIds: new Set([102]) });
      await flushVirtualizer();
      expect(wrapper.find('.new-orders-indicator').exists()).toBe(true);

      scrollToSpy.mockClear();
      await wrapper.find('.new-orders-indicator').trigger('click');
      await flushVirtualizer();

      expect(scrollToSpy).toHaveBeenCalled();
      expect(wrapper.find('.new-orders-indicator').exists()).toBe(false);
    });

    it('returning manually to the bottom resumes live-follow and clears the pending indicator', async () => {
      const wrapper = mount(OrdersCard, {
        props: { ...base, orders: [order101], loaded: true, recentlyArrivedOrderIds: new Set() },
      });
      await flushVirtualizer();

      const scrollEl = wrapper.find('[role="list"]').element as HTMLElement;
      setScrollGeometry(scrollEl, { scrollHeight: 1000, clientHeight: 416, scrollTop: 0 });
      await wrapper.find('[role="list"]').trigger('scroll'); // away from bottom

      await wrapper.setProps({ orders: [order101, order102], recentlyArrivedOrderIds: new Set([102]) });
      await flushVirtualizer();
      expect(wrapper.find('.new-orders-indicator').exists()).toBe(true);

      setScrollGeometry(scrollEl, { scrollHeight: 1000, clientHeight: 416, scrollTop: 1000 - 416 }); // back near bottom
      await wrapper.find('[role="list"]').trigger('scroll');

      expect(wrapper.find('.new-orders-indicator').exists()).toBe(false);
    });

    it('resets live-follow/pending state when the selected user changes', async () => {
      const wrapper = mount(OrdersCard, {
        props: { ...base, orders: [order101], loaded: true, recentlyArrivedOrderIds: new Set() },
      });
      await flushVirtualizer();

      const scrollEl = wrapper.find('[role="list"]').element as HTMLElement;
      setScrollGeometry(scrollEl, { scrollHeight: 1000, clientHeight: 416, scrollTop: 0 });
      await wrapper.find('[role="list"]').trigger('scroll');

      await wrapper.setProps({ orders: [order101, order102], recentlyArrivedOrderIds: new Set([102]) });
      await flushVirtualizer();
      expect(wrapper.find('.new-orders-indicator').exists()).toBe(true);

      await wrapper.setProps({ selectedUserId: 2, orders: [], recentlyArrivedOrderIds: new Set(), loaded: true });
      await flushVirtualizer();

      expect(wrapper.find('.new-orders-indicator').exists()).toBe(false);
    });
  });

  describe('stable viewport height', () => {
    it('reserves the same height across loading, loaded-empty, and rendered-list states', async () => {
      const wrapper = mount(OrdersCard, { props: { ...base, loading: true } });
      const viewport = wrapper.find('[data-testid="orders-viewport"]');
      expect((viewport.element as HTMLElement).style.height).toBe('416px');

      await wrapper.setProps({ loading: false, loaded: true });
      expect((viewport.element as HTMLElement).style.height).toBe('416px');

      await wrapper.setProps({ orders: MOCK_ORDERS.slice(0, 2) });
      expect((viewport.element as HTMLElement).style.height).toBe('416px');
    });
  });
});