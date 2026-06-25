import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia } from 'pinia';
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import { MOCK_USERS, MOCK_ORDERS } from '@portal/users/utils';
import App from './App.vue';
import { routes } from './routes';
import * as dataAccess from '@portal/users-vue/data-access';

// Stub the WebSocket stream (no real socket in jsdom) and the API fns.
vi.mock('@portal/users-vue/data-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@portal/users-vue/data-access')>();
  return {
    ...actual,
    useOrdersStream: vi.fn(),
    fetchUsers: vi.fn(),
    fetchOrdersByUser: vi.fn(),
  };
});

describe('App (integration)', () => {
  beforeEach(() => {
    vi.mocked(dataAccess.fetchUsers).mockResolvedValue(MOCK_USERS);
    vi.mocked(dataAccess.fetchOrdersByUser).mockImplementation((id) =>
      Promise.resolve(MOCK_ORDERS.filter((o) => o.userId === id)),
    );
  });
  afterEach(() => vi.clearAllMocks());

  it('routes to the smart container and renders the dashboard', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    router.push('/users');
    await router.isReady();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    const wrapper = mount(App, {
      global: { plugins: [router, createPinia(), [VueQueryPlugin, { queryClient }]] },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('Users orders dashboard');
    expect(dataAccess.useOrdersStream).toHaveBeenCalled();
  });
});