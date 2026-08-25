// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useOrdersStream, drainPendingOrders } from './use-orders-stream';
import { useUsersStore } from '../store/users.store';
import type { Order, User } from '@portal/users/utils';
import { DEFAULT_ORDERS_WS_URL } from '@portal/users/utils';

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
    useUsersStore.setState({
      selectedUserId: null,
      notifications: [],
      recentlyArrivedOrderIds: new Set(),
      unseenOrderCountsByUserId: {},
    });
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

    const expectedUrl = import.meta.env['VITE_ORDERS_WS_URL'] ?? DEFAULT_ORDERS_WS_URL;
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.latest().url).toBe(expectedUrl);
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

  it('does not duplicate an order already present in the cache (REST snapshot vs. WS race)', () => {
    // The initial REST fetch now reads the same canonical live store this order
    // came from, so it can race this WS message and already include it.
    const { queryClient, wrapper } = makeWrapper();
    const existing: Order[] = [{ id: 101, userId: 1, total: 120 }, ORDER_NORMAL];
    queryClient.setQueryData<Order[]>(['orders', 1], existing);

    renderHook(() => useOrdersStream(), { wrapper });
    MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_NORMAL });

    expect(queryClient.getQueryData<Order[]>(['orders', 1])).toEqual(existing);
  });

  it('removes canonically-evicted orders before upserting the incoming order (retention propagation)', () => {
    const { queryClient, wrapper } = makeWrapper();
    const thirtyExisting: Order[] = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, userId: 1, total: 1 }));
    queryClient.setQueryData<Order[]>(['orders', 1], thirtyExisting);

    renderHook(() => useOrdersStream(), { wrapper });
    const NEW_ORDER: Order = { id: 999, userId: 1, total: 42 };
    MockWebSocket.latest().emit({ type: 'order-update', payload: NEW_ORDER, removedOrderIds: [1] });

    const result = queryClient.getQueryData<Order[]>(['orders', 1]);
    expect(result).toHaveLength(30); // never grows past the canonical retained count
    expect(result?.some((o) => o.id === 1)).toBe(false); // evicted order is absent
    expect(result?.some((o) => o.id === 999)).toBe(true); // new order is present
  });

  it('does not remove anything when removedOrderIds is absent', () => {
    const { queryClient, wrapper } = makeWrapper();
    const existing: Order[] = [{ id: 101, userId: 1, total: 120 }];
    queryClient.setQueryData<Order[]>(['orders', 1], existing);

    renderHook(() => useOrdersStream(), { wrapper });
    MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_NORMAL });

    expect(queryClient.getQueryData<Order[]>(['orders', 1])).toEqual([...existing, ORDER_NORMAL]);
  });

  it('stays bounded at the canonical retained count across repeated evicting updates', () => {
    const { queryClient, wrapper } = makeWrapper();
    queryClient.setQueryData<Order[]>(['orders', 1], [
      { id: 1, userId: 1, total: 1 },
      { id: 2, userId: 1, total: 1 },
    ]);

    renderHook(() => useOrdersStream(), { wrapper });
    const ws = MockWebSocket.latest();
    ws.emit({ type: 'order-update', payload: { id: 1001, userId: 1, total: 1 }, removedOrderIds: [1] });
    ws.emit({ type: 'order-update', payload: { id: 1002, userId: 1, total: 1 }, removedOrderIds: [2] });
    ws.emit({ type: 'order-update', payload: { id: 1003, userId: 1, total: 1 }, removedOrderIds: [1001] });

    const result = queryClient.getQueryData<Order[]>(['orders', 1]);
    expect(result).toHaveLength(2);
    expect(result?.map((o) => o.id).sort()).toEqual([1002, 1003]);
  });

  it('buffers the order into pending when no cache exists for that user', () => {
    const { queryClient, wrapper } = makeWrapper();
    renderHook(() => useOrdersStream(), { wrapper });

    MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_NORMAL });

    expect(queryClient.getQueryData(['orders', ORDER_NORMAL.userId])).toBeUndefined();
    expect(drainPendingOrders(ORDER_NORMAL.userId)).toEqual([ORDER_NORMAL]);
  });

  it('prunes an evicted id out of the pending buffer too, so it can never be drained back in', () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useOrdersStream(), { wrapper });
    const ws = MockWebSocket.latest();

    // No cache yet for user 1 — both buffer.
    ws.emit({ type: 'order-update', payload: { id: 1, userId: 1, total: 1 } });
    ws.emit({ type: 'order-update', payload: { id: 2, userId: 1, total: 1 }, removedOrderIds: [1] });

    expect(drainPendingOrders(1)).toEqual([{ id: 2, userId: 1, total: 1 }]);
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

  // Live WebSocket order visual feedback (Post-production / Portfolio
  // Polish) — this reuses the SAME ws.onmessage handler already under test
  // above; these tests only cover the new store-wiring branch, not a second
  // WS subscription (there isn't one — MockWebSocket.instances staying at 1
  // throughout every test in this file is itself proof of that).
  describe('live order feedback', () => {
    it('marks a WS order for the currently selected user as recently arrived', () => {
      const { queryClient, wrapper } = makeWrapper();
      queryClient.setQueryData<Order[]>(['orders', 1], []);
      useUsersStore.setState({ selectedUserId: 1 });

      renderHook(() => useOrdersStream(), { wrapper });
      MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_NORMAL });

      expect(useUsersStore.getState().recentlyArrivedOrderIds.has(ORDER_NORMAL.id)).toBe(true);
    });

    it('clears the recently-arrived state again after the highlight duration (~2.5s)', () => {
      const { queryClient, wrapper } = makeWrapper();
      queryClient.setQueryData<Order[]>(['orders', 1], []);
      useUsersStore.setState({ selectedUserId: 1 });

      renderHook(() => useOrdersStream(), { wrapper });
      MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_NORMAL });
      expect(useUsersStore.getState().recentlyArrivedOrderIds.has(ORDER_NORMAL.id)).toBe(true);

      vi.advanceTimersByTime(2500);

      expect(useUsersStore.getState().recentlyArrivedOrderIds.has(ORDER_NORMAL.id)).toBe(false);
    });

    it('does NOT mark anything recently-arrived for a user that is not currently selected', () => {
      const { queryClient, wrapper } = makeWrapper();
      queryClient.setQueryData<Order[]>(['orders', 2], []);
      useUsersStore.setState({ selectedUserId: 1 }); // ORDER_NORMAL is for user 1... use a different selection

      const orderForUser2: Order = { id: 205, userId: 2, total: 30 };
      renderHook(() => useOrdersStream(), { wrapper });
      MockWebSocket.latest().emit({ type: 'order-update', payload: orderForUser2 });

      expect(useUsersStore.getState().recentlyArrivedOrderIds.has(orderForUser2.id)).toBe(false);
    });

    it('increments the unseen-order count for a WS order arriving for a user who is NOT selected', () => {
      const { wrapper } = makeWrapper();
      useUsersStore.setState({ selectedUserId: 1 });

      const orderForUser2: Order = { id: 205, userId: 2, total: 30 };
      renderHook(() => useOrdersStream(), { wrapper });
      MockWebSocket.latest().emit({ type: 'order-update', payload: orderForUser2 });

      expect(useUsersStore.getState().unseenOrderCountsByUserId).toEqual({ 2: 1 });
    });

    it('increments cleanly across multiple unseen orders for the same unselected user (+1, +2, ...)', () => {
      const { wrapper } = makeWrapper();
      useUsersStore.setState({ selectedUserId: 1 });

      renderHook(() => useOrdersStream(), { wrapper });
      const ws = MockWebSocket.latest();
      ws.emit({ type: 'order-update', payload: { id: 205, userId: 2, total: 10 } });
      ws.emit({ type: 'order-update', payload: { id: 206, userId: 2, total: 10 } });
      ws.emit({ type: 'order-update', payload: { id: 207, userId: 2, total: 10 } });

      expect(useUsersStore.getState().unseenOrderCountsByUserId).toEqual({ 2: 3 });
    });

    it('immediately clears an evicted order id from recentlyArrivedOrderIds (retention compatibility)', () => {
      const { queryClient, wrapper } = makeWrapper();
      queryClient.setQueryData<Order[]>(['orders', 1], []);
      useUsersStore.setState({ selectedUserId: 1 });

      renderHook(() => useOrdersStream(), { wrapper });
      const ws = MockWebSocket.latest();
      ws.emit({ type: 'order-update', payload: ORDER_NORMAL });
      expect(useUsersStore.getState().recentlyArrivedOrderIds.has(ORDER_NORMAL.id)).toBe(true);

      // A later insert for the same user evicts ORDER_NORMAL under retention.
      ws.emit({ type: 'order-update', payload: { id: 199, userId: 1, total: 5 }, removedOrderIds: [ORDER_NORMAL.id] });

      expect(useUsersStore.getState().recentlyArrivedOrderIds.has(ORDER_NORMAL.id)).toBe(false);
      expect(useUsersStore.getState().recentlyArrivedOrderIds.has(199)).toBe(true);
      expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    });

    it('introduces no additional WebSocket connection — still exactly one instance', () => {
      const { queryClient, wrapper } = makeWrapper();
      queryClient.setQueryData<Order[]>(['orders', 1], []);
      useUsersStore.setState({ selectedUserId: 1 });

      renderHook(() => useOrdersStream(), { wrapper });
      const ws = MockWebSocket.latest();
      ws.emit({ type: 'order-update', payload: ORDER_NORMAL });
      ws.emit({ type: 'order-update', payload: { id: 205, userId: 2, total: 10 } });

      expect(MockWebSocket.instances).toHaveLength(1);
    });
  });
});
