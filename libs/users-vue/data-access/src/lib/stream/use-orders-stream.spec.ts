// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { useOrdersStream, drainPendingOrders } from './use-orders-stream';
import { useUsersStore } from '../store/users.store';
import type { Order } from '@portal/users/utils';
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

  static reset(): void {
    MockWebSocket.instances = [];
  }
  static latest(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }
}

vi.stubGlobal('WebSocket', MockWebSocket);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORDER_NORMAL: Order = { id: 103, userId: 1, total: 50 };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mountStream(queryClient: QueryClient, pinia: Pinia) {
  const Comp = defineComponent({
    setup() {
      useOrdersStream();
      return () => h('div');
    },
  });
  return mount(Comp, {
    global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useOrdersStream', () => {
  let queryClient: QueryClient;
  let pinia: Pinia;

  beforeEach(() => {
    MockWebSocket.reset();
    pinia = createPinia();
    setActivePinia(pinia);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    drainPendingOrders(1);
    drainPendingOrders(2);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('opens a WebSocket to the orders endpoint on mount', () => {
    mountStream(queryClient, pinia);

    const expectedUrl = import.meta.env['VITE_ORDERS_WS_URL']?.trim() || DEFAULT_ORDERS_WS_URL;
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.latest().url).toBe(expectedUrl);
  });

  it('closes the WebSocket on unmount', () => {
    const wrapper = mountStream(queryClient, pinia);
    const ws = MockWebSocket.latest();

    wrapper.unmount();

    expect(ws.close).toHaveBeenCalledOnce();
  });

  it('ignores messages with unknown event types', () => {
    queryClient.setQueryData<Order[]>(['orders', 1], []);
    mountStream(queryClient, pinia);

    MockWebSocket.latest().emit({ type: 'unknown-event', payload: ORDER_NORMAL });

    expect(queryClient.getQueryData<Order[]>(['orders', 1])).toEqual([]);
  });

  it('ignores malformed JSON without throwing', () => {
    mountStream(queryClient, pinia);

    expect(() => MockWebSocket.latest().emitRaw('not-json')).not.toThrow();
  });

  it('appends the incoming order to the existing cache for that user', () => {
    const existing: Order[] = [{ id: 101, userId: 1, total: 120 }];
    queryClient.setQueryData<Order[]>(['orders', 1], existing);

    mountStream(queryClient, pinia);
    MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_NORMAL });

    expect(queryClient.getQueryData<Order[]>(['orders', 1])).toEqual([...existing, ORDER_NORMAL]);
  });

  it('does not duplicate an order already present in the cache (REST snapshot vs. WS race)', () => {
    // The initial REST fetch now reads the same canonical live store this order
    // came from, so it can race this WS message and already include it.
    const existing: Order[] = [{ id: 101, userId: 1, total: 120 }, ORDER_NORMAL];
    queryClient.setQueryData<Order[]>(['orders', 1], existing);

    mountStream(queryClient, pinia);
    MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_NORMAL });

    expect(queryClient.getQueryData<Order[]>(['orders', 1])).toEqual(existing);
  });

  it('removes canonically-evicted orders before upserting the incoming order (retention propagation)', () => {
    const thirtyExisting: Order[] = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, userId: 1, total: 1 }));
    queryClient.setQueryData<Order[]>(['orders', 1], thirtyExisting);

    mountStream(queryClient, pinia);
    const NEW_ORDER: Order = { id: 999, userId: 1, total: 42 };
    MockWebSocket.latest().emit({ type: 'order-update', payload: NEW_ORDER, removedOrderIds: [1] });

    const result = queryClient.getQueryData<Order[]>(['orders', 1]);
    expect(result).toHaveLength(30); // never grows past the canonical retained count
    expect(result?.some((o) => o.id === 1)).toBe(false); // evicted order is absent
    expect(result?.some((o) => o.id === 999)).toBe(true); // new order is present
  });

  it('does not remove anything when removedOrderIds is absent', () => {
    const existing: Order[] = [{ id: 101, userId: 1, total: 120 }];
    queryClient.setQueryData<Order[]>(['orders', 1], existing);

    mountStream(queryClient, pinia);
    MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_NORMAL });

    expect(queryClient.getQueryData<Order[]>(['orders', 1])).toEqual([...existing, ORDER_NORMAL]);
  });

  it('stays bounded at the canonical retained count across repeated evicting updates', () => {
    queryClient.setQueryData<Order[]>(['orders', 1], [
      { id: 1, userId: 1, total: 1 },
      { id: 2, userId: 1, total: 1 },
    ]);

    mountStream(queryClient, pinia);
    const ws = MockWebSocket.latest();
    ws.emit({ type: 'order-update', payload: { id: 1001, userId: 1, total: 1 }, removedOrderIds: [1] });
    ws.emit({ type: 'order-update', payload: { id: 1002, userId: 1, total: 1 }, removedOrderIds: [2] });
    ws.emit({ type: 'order-update', payload: { id: 1003, userId: 1, total: 1 }, removedOrderIds: [1001] });

    const result = queryClient.getQueryData<Order[]>(['orders', 1]);
    expect(result).toHaveLength(2);
    expect(result?.map((o) => o.id).sort()).toEqual([1002, 1003]);
  });

  it('prunes an evicted id out of the pending buffer too, so it can never be drained back in (no duplicate/stale evicted order remains)', () => {
    mountStream(queryClient, pinia);
    const ws = MockWebSocket.latest();

    // No cache yet for user 1 — both buffer.
    ws.emit({ type: 'order-update', payload: { id: 1, userId: 1, total: 1 } });
    ws.emit({ type: 'order-update', payload: { id: 2, userId: 1, total: 1 }, removedOrderIds: [1] });

    expect(drainPendingOrders(1)).toEqual([{ id: 2, userId: 1, total: 1 }]);
  });

  it('buffers the order into pending when no cache exists for that user', () => {
    mountStream(queryClient, pinia);

    MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_NORMAL });

    expect(queryClient.getQueryData(['orders', ORDER_NORMAL.userId])).toBeUndefined();
    expect(drainPendingOrders(ORDER_NORMAL.userId)).toEqual([ORDER_NORMAL]);
  });

  it('drainPendingOrders returns buffered orders then clears the buffer', () => {
    mountStream(queryClient, pinia);

    MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_NORMAL });

    expect(drainPendingOrders(ORDER_NORMAL.userId)).toEqual([ORDER_NORMAL]);
    expect(drainPendingOrders(ORDER_NORMAL.userId)).toEqual([]);
  });

  it('resets monitoring state on unmount so remount starts with a fresh learning tick', () => {
    queryClient.setQueryData<Order[]>(['orders', 1], []);
    const wrapper = mountStream(queryClient, pinia);
    const ws1 = MockWebSocket.latest();

    ws1.emit({ type: 'order-update', payload: { id: 104, userId: 1, total: 600 } });
    wrapper.unmount();
    useUsersStore().$patch({ notifications: [] });

    mountStream(queryClient, pinia);
    MockWebSocket.latest().emit({ type: 'order-update', payload: { id: 105, userId: 1, total: 600 } });

    // First tick after remount is a learning tick again — no toast yet.
    expect(useUsersStore().notifications).toHaveLength(0);
  });
});
