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
});