// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';
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

async function mountStream(queryClient: QueryClient, pinia: Pinia, initialPath = '/users') {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/users', component: { render: () => null } },
      { path: '/users/:userId', component: { render: () => null } },
    ],
  });
  router.push(initialPath);
  await router.isReady();

  const Comp = defineComponent({
    setup() {
      useOrdersStream();
      return () => h('div');
    },
  });
  return mount(Comp, {
    global: { plugins: [router, pinia, [VueQueryPlugin, { queryClient }]] },
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

  it('opens a WebSocket to the orders endpoint on mount', async () => {
    await mountStream(queryClient, pinia);

    const expectedUrl = import.meta.env['VITE_ORDERS_WS_URL']?.trim() || DEFAULT_ORDERS_WS_URL;
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.latest().url).toBe(expectedUrl);
  });

  it('appends the demo-owner viewerToken to the WebSocket URL when set in localStorage', async () => {
    localStorage.setItem('usersPortalDemoOwnerToken', 'owner-abc');
    await mountStream(queryClient, pinia);

    expect(MockWebSocket.latest().url).toContain('viewerToken=owner-abc');
    localStorage.clear();
  });

  it('closes the WebSocket on unmount', async () => {
    const wrapper = await mountStream(queryClient, pinia);
    const ws = MockWebSocket.latest();

    wrapper.unmount();

    expect(ws.close).toHaveBeenCalledOnce();
  });

  it('ignores messages with unknown event types', async () => {
    queryClient.setQueryData<Order[]>(['orders', 1], []);
    await mountStream(queryClient, pinia);

    MockWebSocket.latest().emit({ type: 'unknown-event', payload: ORDER_NORMAL });

    expect(queryClient.getQueryData<Order[]>(['orders', 1])).toEqual([]);
  });

  it('ignores malformed JSON without throwing', async () => {
    await mountStream(queryClient, pinia);

    expect(() => MockWebSocket.latest().emitRaw('not-json')).not.toThrow();
  });

  it('appends the incoming order to the existing cache for that user', async () => {
    const existing: Order[] = [{ id: 101, userId: 1, total: 120 }];
    queryClient.setQueryData<Order[]>(['orders', 1], existing);

    await mountStream(queryClient, pinia);
    MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_NORMAL });

    expect(queryClient.getQueryData<Order[]>(['orders', 1])).toEqual([...existing, ORDER_NORMAL]);
  });

  it('does not duplicate an order already present in the cache (REST snapshot vs. WS race)', async () => {
    // The initial REST fetch now reads the same canonical live store this order
    // came from, so it can race this WS message and already include it.
    const existing: Order[] = [{ id: 101, userId: 1, total: 120 }, ORDER_NORMAL];
    queryClient.setQueryData<Order[]>(['orders', 1], existing);

    await mountStream(queryClient, pinia);
    MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_NORMAL });

    expect(queryClient.getQueryData<Order[]>(['orders', 1])).toEqual(existing);
  });

  it('removes canonically-evicted orders before upserting the incoming order (retention propagation)', async () => {
    const thirtyExisting: Order[] = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, userId: 1, total: 1 }));
    queryClient.setQueryData<Order[]>(['orders', 1], thirtyExisting);

    await mountStream(queryClient, pinia);
    const NEW_ORDER: Order = { id: 999, userId: 1, total: 42 };
    MockWebSocket.latest().emit({ type: 'order-update', payload: NEW_ORDER, removedOrderIds: [1] });

    const result = queryClient.getQueryData<Order[]>(['orders', 1]);
    expect(result).toHaveLength(30); // never grows past the canonical retained count
    expect(result?.some((o) => o.id === 1)).toBe(false); // evicted order is absent
    expect(result?.some((o) => o.id === 999)).toBe(true); // new order is present
  });

  it('does not remove anything when removedOrderIds is absent', async () => {
    const existing: Order[] = [{ id: 101, userId: 1, total: 120 }];
    queryClient.setQueryData<Order[]>(['orders', 1], existing);

    await mountStream(queryClient, pinia);
    MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_NORMAL });

    expect(queryClient.getQueryData<Order[]>(['orders', 1])).toEqual([...existing, ORDER_NORMAL]);
  });

  it('stays bounded at the canonical retained count across repeated evicting updates', async () => {
    queryClient.setQueryData<Order[]>(['orders', 1], [
      { id: 1, userId: 1, total: 1 },
      { id: 2, userId: 1, total: 1 },
    ]);

    await mountStream(queryClient, pinia);
    const ws = MockWebSocket.latest();
    ws.emit({ type: 'order-update', payload: { id: 1001, userId: 1, total: 1 }, removedOrderIds: [1] });
    ws.emit({ type: 'order-update', payload: { id: 1002, userId: 1, total: 1 }, removedOrderIds: [2] });
    ws.emit({ type: 'order-update', payload: { id: 1003, userId: 1, total: 1 }, removedOrderIds: [1001] });

    const result = queryClient.getQueryData<Order[]>(['orders', 1]);
    expect(result).toHaveLength(2);
    expect(result?.map((o) => o.id).sort()).toEqual([1002, 1003]);
  });

  it('prunes an evicted id out of the pending buffer too, so it can never be drained back in (no duplicate/stale evicted order remains)', async () => {
    await mountStream(queryClient, pinia);
    const ws = MockWebSocket.latest();

    // No cache yet for user 1 — both buffer.
    ws.emit({ type: 'order-update', payload: { id: 1, userId: 1, total: 1 } });
    ws.emit({ type: 'order-update', payload: { id: 2, userId: 1, total: 1 }, removedOrderIds: [1] });

    expect(drainPendingOrders(1)).toEqual([{ id: 2, userId: 1, total: 1 }]);
  });

  it('buffers the order into pending when no cache exists for that user', async () => {
    await mountStream(queryClient, pinia);

    MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_NORMAL });

    expect(queryClient.getQueryData(['orders', ORDER_NORMAL.userId])).toBeUndefined();
    expect(drainPendingOrders(ORDER_NORMAL.userId)).toEqual([ORDER_NORMAL]);
  });

  it('drainPendingOrders returns buffered orders then clears the buffer', async () => {
    await mountStream(queryClient, pinia);

    MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_NORMAL });

    expect(drainPendingOrders(ORDER_NORMAL.userId)).toEqual([ORDER_NORMAL]);
    expect(drainPendingOrders(ORDER_NORMAL.userId)).toEqual([]);
  });

  it('resets monitoring state on unmount so remount starts with a fresh learning tick', async () => {
    queryClient.setQueryData<Order[]>(['orders', 1], []);
    const wrapper = await mountStream(queryClient, pinia);
    const ws1 = MockWebSocket.latest();

    ws1.emit({ type: 'order-update', payload: { id: 104, userId: 1, total: 600 } });
    wrapper.unmount();
    useUsersStore().$patch({ notifications: [] });

    await mountStream(queryClient, pinia);
    MockWebSocket.latest().emit({ type: 'order-update', payload: { id: 105, userId: 1, total: 600 } });

    // First tick after remount is a learning tick again — no toast yet.
    expect(useUsersStore().notifications).toHaveLength(0);
  });

  describe('live order feedback', () => {
    it('marks a WS order for the currently-selected user as recently arrived', async () => {
      await mountStream(queryClient, pinia, '/users/1');
      MockWebSocket.latest().emit({ type: 'order-update', payload: { id: 201, userId: 1, total: 10 } });

      expect(useUsersStore().recentlyArrivedOrderIds.has(201)).toBe(true);
    });

    it('clears the highlight after ~2.5s', async () => {
      vi.useFakeTimers();
      await mountStream(queryClient, pinia, '/users/1');
      MockWebSocket.latest().emit({ type: 'order-update', payload: { id: 201, userId: 1, total: 10 } });

      vi.advanceTimersByTime(2500);
      expect(useUsersStore().recentlyArrivedOrderIds.has(201)).toBe(false);
      vi.useRealTimers();
    });

    it('does not mark an order for a user other than the one currently selected', async () => {
      await mountStream(queryClient, pinia, '/users/1');
      MockWebSocket.latest().emit({ type: 'order-update', payload: { id: 202, userId: 2, total: 10 } });

      expect(useUsersStore().recentlyArrivedOrderIds.has(202)).toBe(false);
    });

    it('increments the unseen-order count for an order arriving for a non-selected user', async () => {
      await mountStream(queryClient, pinia, '/users/1');
      MockWebSocket.latest().emit({ type: 'order-update', payload: { id: 202, userId: 2, total: 10 } });

      expect(useUsersStore().unseenOrderCountsByUserId).toEqual({ 2: 1 });
    });

    it('increments the unseen-order count cleanly across multiple arrivals', async () => {
      await mountStream(queryClient, pinia, '/users/1');
      const ws = MockWebSocket.latest();
      ws.emit({ type: 'order-update', payload: { id: 202, userId: 2, total: 10 } });
      ws.emit({ type: 'order-update', payload: { id: 203, userId: 2, total: 10 } });

      expect(useUsersStore().unseenOrderCountsByUserId).toEqual({ 2: 2 });
    });

    it('does not mark anything as recently arrived when no user is selected', async () => {
      await mountStream(queryClient, pinia, '/users');
      MockWebSocket.latest().emit({ type: 'order-update', payload: { id: 202, userId: 2, total: 10 } });

      expect(useUsersStore().recentlyArrivedOrderIds.size).toBe(0);
      expect(useUsersStore().unseenOrderCountsByUserId).toEqual({ 2: 1 });
    });

    it('immediately clears a highlighted order once retention evicts it', async () => {
      await mountStream(queryClient, pinia, '/users/1');
      const ws = MockWebSocket.latest();
      ws.emit({ type: 'order-update', payload: { id: 201, userId: 1, total: 10 } });
      expect(useUsersStore().recentlyArrivedOrderIds.has(201)).toBe(true);

      ws.emit({ type: 'order-update', payload: { id: 999, userId: 1, total: 10 }, removedOrderIds: [201] });
      expect(useUsersStore().recentlyArrivedOrderIds.has(201)).toBe(false);
    });

    it('opens exactly one WebSocket connection regardless of the live-feedback wiring', async () => {
      await mountStream(queryClient, pinia, '/users/1');
      expect(MockWebSocket.instances).toHaveLength(1);
    });
  });
});
