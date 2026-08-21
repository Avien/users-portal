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
