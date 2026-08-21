import { defineComponent, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';
import { createPinia } from 'pinia';
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import { MOCK_USERS, MOCK_ORDERS } from '@portal/users/utils';
import { useUsersFacade } from './use-users-facade';
import * as dataAccess from '@portal/users-vue/data-access';

// Preserve the real Pinia store + drainPendingOrders — only mock the API fns,
// so they resolve instantly (no fake timers needed). Mirrors the React spec.
vi.mock('@portal/users-vue/data-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@portal/users-vue/data-access')>();
  return { ...actual, fetchUsers: vi.fn(), fetchOrdersByUser: vi.fn() };
});

async function mountFacade(initialPath = '/users') {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/users', component: { render: () => null } },
      { path: '/users/:userId', component: { render: () => null } },
    ],
  });
  router.push(initialPath);
  await router.isReady();

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  let facade!: ReturnType<typeof useUsersFacade>;
  const Comp = defineComponent({
    setup() {
      facade = useUsersFacade();
      return () => h('div');
    },
  });
  mount(Comp, {
    global: { plugins: [router, createPinia(), [VueQueryPlugin, { queryClient }]] },
  });
  return { facade, router };
}

describe('useUsersFacade', () => {
  beforeEach(() => {
    vi.mocked(dataAccess.fetchUsers).mockResolvedValue(MOCK_USERS);
    vi.mocked(dataAccess.fetchOrdersByUser).mockImplementation((id) =>
      Promise.resolve(MOCK_ORDERS.filter((o) => o.userId === id)),
    );
  });
  afterEach(() => vi.clearAllMocks());

  it('starts loading with empty users and no selection', async () => {
    const { facade } = await mountFacade();
    expect(facade.loading.value).toBe(true);
    expect(facade.users.value).toEqual([]);
    expect(facade.selectedUserId.value).toBeNull();
  });

  it('resolves users after the fetch completes', async () => {
    const { facade } = await mountFacade();
    await flushPromises();
    expect(facade.loaded.value).toBe(true);
    expect(facade.users.value).toEqual(MOCK_USERS);
    expect(facade.loading.value).toBe(false);
  });

  it('auto-selects the first user after load and fetches their orders', async () => {
    const { facade } = await mountFacade();
    await flushPromises(); // users resolve -> watch fires router.replace
    await flushPromises(); // navigation + orders query settle
    expect(facade.selectedUserId.value).toBe(MOCK_USERS[0].id);
    expect(dataAccess.fetchOrdersByUser).toHaveBeenCalledWith(MOCK_USERS[0].id);
    expect(facade.orders.value).toEqual(
      MOCK_ORDERS.filter((o) => o.userId === MOCK_USERS[0].id),
    );
  });

  it('selectUser navigates to the user route, updating selectedUserId', async () => {
    const { facade } = await mountFacade('/users/1');
    await flushPromises();
    facade.selectUser(2);
    await flushPromises();
    expect(facade.selectedUserId.value).toBe(2);
    expect(dataAccess.fetchOrdersByUser).toHaveBeenCalledWith(2);
  });

  it('returns safe defaults for notifications and error', async () => {
    const { facade } = await mountFacade();
    expect(facade.notifications.value).toEqual([]);
    expect(facade.error.value).toBeNull();
  });

  describe('WS-order-before-HTTP-load race (pending-order drain merge)', () => {
    class MockWebSocket {
      static instances: MockWebSocket[] = [];
      onmessage: ((event: MessageEvent) => void) | null = null;
      close = vi.fn();
      constructor(public readonly url: string) {
        MockWebSocket.instances.push(this);
      }
      emit(data: unknown) {
        this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
      }
      static latest() {
        return MockWebSocket.instances[MockWebSocket.instances.length - 1];
      }
      static reset() {
        MockWebSocket.instances = [];
      }
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('drains pending WS orders by id: collisions keep exactly one copy (WS wins), pending-only orders are retained', async () => {
      vi.stubGlobal('WebSocket', MockWebSocket);
      MockWebSocket.reset();

      let resolveOrders!: (orders: unknown[]) => void;
      vi.mocked(dataAccess.fetchOrdersByUser).mockImplementation(
        () => new Promise((resolve) => { resolveOrders = resolve; }),
      );

      const router: Router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/users/:userId', component: { render: () => null } }],
      });
      router.push('/users/1');
      await router.isReady();

      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      let facade!: ReturnType<typeof useUsersFacade>;
      const Comp = defineComponent({
        setup() {
          dataAccess.useOrdersStream();
          facade = useUsersFacade();
          return () => h('div');
        },
      });
      mount(Comp, {
        global: { plugins: [router, createPinia(), [VueQueryPlugin, { queryClient }]] },
      });
      await flushPromises();

      // Both arrive over WS while the HTTP fetch is still in flight (no cache
      // entry for ['orders', 1] yet) — both get buffered.
      const ORDER_103_FRESH = { id: 103, userId: 1, total: 999, status: 'completed' };
      const ORDER_104_PENDING_ONLY = { id: 104, userId: 1, total: 15, status: 'pending' };
      MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_103_FRESH });
      MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_104_PENDING_ONLY });

      // HTTP snapshot resolves — reading the same canonical store, it already
      // contains id 103 too, but with a stale total (captured before the WS
      // broadcast's update); it does not contain 104 at all.
      const ORDER_101 = { id: 101, userId: 1, total: 120.5, status: 'completed' };
      const ORDER_103_STALE = { id: 103, userId: 1, total: 42, status: 'pending' };
      resolveOrders([ORDER_101, ORDER_103_STALE]);
      await flushPromises();
      await flushPromises();

      const orders = facade.orders.value;
      const ids = orders.map((o) => o.id);

      // Exactly one copy of the colliding id.
      expect(ids.filter((id) => id === 103)).toHaveLength(1);
      // WS payload wins on collision.
      expect(orders.find((o) => o.id === 103)?.total).toBe(999);
      // Pending-only order is retained.
      expect(orders.find((o) => o.id === 104)).toEqual(ORDER_104_PENDING_ONLY);
      // HTTP-only order untouched.
      expect(orders.find((o) => o.id === 101)).toEqual(ORDER_101);
      // Existing HTTP-snapshot ordering preserved (101 before 103); pending-only appended after.
      expect(ids).toEqual([101, 103, 104]);
    });

    it('two buffered WS updates for the same pending-only id drain to exactly one order, latest payload winning', async () => {
      vi.stubGlobal('WebSocket', MockWebSocket);
      MockWebSocket.reset();

      let resolveOrders!: (orders: unknown[]) => void;
      vi.mocked(dataAccess.fetchOrdersByUser).mockImplementation(
        () => new Promise((resolve) => { resolveOrders = resolve; }),
      );

      const router: Router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/users/:userId', component: { render: () => null } }],
      });
      router.push('/users/1');
      await router.isReady();

      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      let facade!: ReturnType<typeof useUsersFacade>;
      const Comp = defineComponent({
        setup() {
          dataAccess.useOrdersStream();
          facade = useUsersFacade();
          return () => h('div');
        },
      });
      mount(Comp, {
        global: { plugins: [router, createPinia(), [VueQueryPlugin, { queryClient }]] },
      });
      await flushPromises();

      // The same pending-only order id arrives twice over WS (e.g. a status
      // update) before the HTTP fetch resolves — both buffer, since the cache
      // for ['orders', 1] doesn't exist yet.
      const ORDER_105_V1 = { id: 105, userId: 1, total: 30, status: 'pending' };
      const ORDER_105_V2 = { id: 105, userId: 1, total: 30, status: 'completed' };
      MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_105_V1 });
      MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_105_V2 });

      const ORDER_101 = { id: 101, userId: 1, total: 120.5, status: 'completed' };
      resolveOrders([ORDER_101]);
      await flushPromises();
      await flushPromises();

      const orders = facade.orders.value;
      const matches = orders.filter((o) => o.id === 105);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toEqual(ORDER_105_V2);
    });
  });
});