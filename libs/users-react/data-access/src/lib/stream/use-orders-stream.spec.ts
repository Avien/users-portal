// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useOrdersStream, drainPendingOrders } from './use-orders-stream';
import { useUsersStore } from '../store/users.store';
import type { Order, User } from '@portal/users/utils';

// ─── WebSocket mock ───────────────────────────────────────────────────────────

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly close = vi.fn();

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  emit(data: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  emitRaw(raw: string): void {
    this.onmessage?.(new MessageEvent('message', { data: raw }));
  }

  static reset(): void { MockWebSocket.instances = []; }
  static latest(): MockWebSocket { return MockWebSocket.instances[MockWebSocket.instances.length - 1]; }
}

vi.stubGlobal('WebSocket', MockWebSocket);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_USERS: User[] = [
  { id: 1, name: 'Avi Cohen' },
  { id: 2, name: 'Dana Levi' },
];

const ORDER_NORMAL: Order    = { id: 103, userId: 1, total: 50 };
const ORDER_HIGH_VALUE: Order = { id: 104, userId: 1, total: 600 };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useOrdersStream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.reset();
    useUsersStore.setState({ selectedUserId: null, notifications: [] });
    // clear any pending buffer left from previous tests
    drainPendingOrders(1);
    drainPendingOrders(2);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('opens a WebSocket to the orders endpoint on mount', () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useOrdersStream(), { wrapper });

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.latest().url).toBe('ws://localhost:3000/orders');
  });

  it('closes the WebSocket on unmount', () => {
    const { wrapper } = makeWrapper();
    const { unmount } = renderHook(() => useOrdersStream(), { wrapper });

    const ws = MockWebSocket.latest();
    unmount();

    expect(ws.close).toHaveBeenCalledOnce();
  });

  it('ignores messages with unknown event types', () => {
    const { queryClient, wrapper } = makeWrapper();
    queryClient.setQueryData<Order[]>(['orders', 1], []);
    renderHook(() => useOrdersStream(), { wrapper });

    MockWebSocket.latest().emit({ type: 'unknown-event', payload: ORDER_NORMAL });

    expect(queryClient.getQueryData<Order[]>(['orders', 1])).toEqual([]);
  });

  it('ignores malformed JSON without throwing', () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useOrdersStream(), { wrapper });

    expect(() => MockWebSocket.latest().emitRaw('not-json')).not.toThrow();
  });

  it('appends the incoming order to the existing cache for that user', () => {
    const { queryClient, wrapper } = makeWrapper();
    const existing: Order[] = [{ id: 101, userId: 1, total: 120 }];
    queryClient.setQueryData<Order[]>(['orders', 1], existing);

    renderHook(() => useOrdersStream(), { wrapper });
    MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_NORMAL });

    expect(queryClient.getQueryData<Order[]>(['orders', 1])).toEqual([
      ...existing,
      ORDER_NORMAL,
    ]);
  });

  it('buffers the order into pending when no cache exists for that user', () => {
    const { queryClient, wrapper } = makeWrapper();
    renderHook(() => useOrdersStream(), { wrapper });

    MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_NORMAL });

    expect(queryClient.getQueryData(['orders', ORDER_NORMAL.userId])).toBeUndefined();
    expect(drainPendingOrders(ORDER_NORMAL.userId)).toEqual([ORDER_NORMAL]);
  });

  it('drainPendingOrders returns buffered orders then clears the buffer', () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useOrdersStream(), { wrapper });

    MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_NORMAL });

    expect(drainPendingOrders(ORDER_NORMAL.userId)).toEqual([ORDER_NORMAL]);
    expect(drainPendingOrders(ORDER_NORMAL.userId)).toEqual([]);
  });

  it('does not emit notifications on the first stream order (learning tick)', () => {
    const { queryClient, wrapper } = makeWrapper();
    queryClient.setQueryData<User[]>(['users'], MOCK_USERS);
    queryClient.setQueryData<Order[]>(['orders', 1], []);

    renderHook(() => useOrdersStream(), { wrapper });
    MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_HIGH_VALUE });

    expect(useUsersStore.getState().notifications).toHaveLength(0);
  });

  it('emits a warning notification for a high-value order after the learning tick', () => {
    const { queryClient, wrapper } = makeWrapper();
    queryClient.setQueryData<User[]>(['users'], MOCK_USERS);
    queryClient.setQueryData<Order[]>(['orders', 1], []);

    renderHook(() => useOrdersStream(), { wrapper });
    const ws = MockWebSocket.latest();

    // First tick — learning only, no toasts
    ws.emit({ type: 'order-update', payload: ORDER_NORMAL });
    // Second tick — new high-value order triggers warning
    ws.emit({ type: 'order-update', payload: ORDER_HIGH_VALUE });

    const notifications = useUsersStore.getState().notifications;
    expect(notifications).toHaveLength(1);
    expect(notifications[0].severity).toBe('warning');
    expect(notifications[0].message).toContain(ORDER_HIGH_VALUE.id.toString());
  });

  it('resets monitoring state on unmount so remount starts with a fresh learning tick', () => {
    const { queryClient, wrapper } = makeWrapper();
    queryClient.setQueryData<User[]>(['users'], MOCK_USERS);
    queryClient.setQueryData<Order[]>(['orders', 1], []);

    const { unmount } = renderHook(() => useOrdersStream(), { wrapper });
    const ws1 = MockWebSocket.latest();

    // Build up monitoring state over two ticks
    ws1.emit({ type: 'order-update', payload: ORDER_NORMAL });
    ws1.emit({ type: 'order-update', payload: ORDER_HIGH_VALUE });
    unmount();

    useUsersStore.setState({ notifications: [] });

    // Remount — the first tick should be a learning tick again, no toasts
    renderHook(() => useOrdersStream(), { wrapper });
    MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_HIGH_VALUE });

    expect(useUsersStore.getState().notifications).toHaveLength(0);
  });
});
