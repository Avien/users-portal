import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useUsersFacade } from './use-users-facade';
import * as dataAccess from '@portal/users-react/data-access';
import { useUsersStore } from '@portal/users-react/data-access';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const MOCK_USERS = [
  { id: 1, name: 'Alice Johnson' },
  { id: 2, name: 'Bob Smith' },
];

const MOCK_ORDERS = [
  { id: 1, userId: 1, total: 1200 },
  { id: 2, userId: 1, total: 25 },
];

// Preserve real useUsersStore — only mock API functions
vi.mock('@portal/users-react/data-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@portal/users-react/data-access')>();
  return {
    ...actual,
    fetchUsers: vi.fn(),
    fetchOrdersByUser: vi.fn(),
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

// useNavigate + useParams require a Router context and a matched Route to extract params.
// MemoryRouter lets us control the initial URL; the Route with :userId makes useParams work.
function makeWrapper(initialPath = '/users') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return createElement(
      MemoryRouter, { initialEntries: [initialPath] },
      createElement(Routes, null,
        createElement(Route, {
          path: '/users/:userId',
          element: createElement(QueryClientProvider, { client: queryClient }, children),
        }),
        createElement(Route, {
          path: '/users',
          element: createElement(QueryClientProvider, { client: queryClient }, children),
        })
      )
    );
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useUsersFacade', () => {
  beforeEach(() => {
    useUsersStore.setState({
      notifications: [],
      selectedUserId: null,
      recentlyArrivedOrderIds: new Set(),
      unseenOrderCountsByUserId: {},
    });
    vi.mocked(dataAccess.fetchUsers).mockResolvedValue(MOCK_USERS);
    vi.mocked(dataAccess.fetchOrdersByUser).mockResolvedValue(MOCK_ORDERS);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts with loading=true and empty users', () => {
    const { result } = renderHook(() => useUsersFacade(), { wrapper: makeWrapper() });
    expect(result.current.loading).toBe(true);
    expect(result.current.users).toEqual([]);
    expect(result.current.selectedUserId).toBeNull();
  });

  it('resolves users after fetch completes', async () => {
    const { result } = renderHook(() => useUsersFacade(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.users).toEqual(MOCK_USERS);
    expect(result.current.loading).toBe(false);
  });

  it('auto-selects first user after load and fetches their orders', async () => {
    const { result } = renderHook(() => useUsersFacade(), { wrapper: makeWrapper() });
    // navigate('/users/1') fires after users load — waitFor lets the location update propagate
    await waitFor(() => expect(result.current.selectedUserId).toBe(1));
    await waitFor(() => expect(result.current.orders).toEqual(MOCK_ORDERS));
    expect(dataAccess.fetchOrdersByUser).toHaveBeenCalledWith(1);
  });

  it('selectUser updates selectedUserId and triggers orders fetch', async () => {
    const { result } = renderHook(() => useUsersFacade(), { wrapper: makeWrapper('/users/1') });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => { result.current.selectUser(2); });
    await waitFor(() => expect(result.current.selectedUserId).toBe(2));
    await waitFor(() => expect(dataAccess.fetchOrdersByUser).toHaveBeenCalledWith(2));
  });

  it('selecting a different user re-fetches orders for the new user', async () => {
    const { result } = renderHook(() => useUsersFacade(), { wrapper: makeWrapper('/users/1') });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => { result.current.selectUser(2); });
    await waitFor(() => expect(dataAccess.fetchOrdersByUser).toHaveBeenCalledWith(2));
  });

  it('returns safe defaults for unimplemented VM fields', () => {
    const { result } = renderHook(() => useUsersFacade(), { wrapper: makeWrapper() });
    expect(result.current.selectedUserSummary).toBeNull();
    expect(result.current.notifications).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('exposes stable selectUser reference across re-renders', async () => {
    const { result, rerender } = renderHook(() => useUsersFacade(), { wrapper: makeWrapper('/users/1') });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const first = result.current.selectUser;
    rerender();
    expect(result.current.selectUser).toBe(first);
  });

  describe('live order feedback wiring', () => {
    it('mirrors the route-derived selectedUserId into the store for useOrdersStream to read', async () => {
      renderHook(() => useUsersFacade(), { wrapper: makeWrapper('/users/2') });
      await waitFor(() => expect(useUsersStore.getState().selectedUserId).toBe(2));
    });

    it('clears the unseen-order badge for a user once they are selected', async () => {
      useUsersStore.setState({ unseenOrderCountsByUserId: { 2: 3 } });
      renderHook(() => useUsersFacade(), { wrapper: makeWrapper('/users/2') });
      await waitFor(() => expect(useUsersStore.getState().selectedUserId).toBe(2));
      expect(useUsersStore.getState().unseenOrderCountsByUserId).toEqual({});
    });

    it('leaves other users\' unseen counts untouched on selection', async () => {
      useUsersStore.setState({ unseenOrderCountsByUserId: { 1: 2, 2: 3 } });
      renderHook(() => useUsersFacade(), { wrapper: makeWrapper('/users/2') });
      await waitFor(() => expect(useUsersStore.getState().selectedUserId).toBe(2));
      expect(useUsersStore.getState().unseenOrderCountsByUserId).toEqual({ 1: 2 });
    });

    it('exposes recentlyArrivedOrderIds and unseenOrderCountsByUserId from the store', () => {
      useUsersStore.setState({
        recentlyArrivedOrderIds: new Set([101]),
        unseenOrderCountsByUserId: { 5: 1 },
      });
      const { result } = renderHook(() => useUsersFacade(), { wrapper: makeWrapper() });
      expect(result.current.recentlyArrivedOrderIds).toEqual(new Set([101]));
      expect(result.current.unseenOrderCountsByUserId).toEqual({ 5: 1 });
    });
  });

  describe('WS-before-HTTP hydration race with a canonical eviction', () => {
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

    it(
      'a WS eviction that arrives before the initial HTTP fetch resolves is reconciled once it does — ' +
        'the stale (already in-flight) HTTP snapshot still containing the evicted order must not reintroduce it',
      async () => {
        vi.stubGlobal('WebSocket', MockWebSocket);
        MockWebSocket.reset();

        // The HTTP fetch for user 1 is already in flight — controlled manually
        // so it can resolve AFTER the WS eviction below, simulating the race.
        let resolveOrders!: (orders: unknown[]) => void;
        vi.mocked(dataAccess.fetchOrdersByUser).mockImplementation(
          () => new Promise((resolve) => (resolveOrders = resolve))
        );

        const { result } = renderHook(
          () => {
            dataAccess.useOrdersStream();
            return useUsersFacade();
          },
          { wrapper: makeWrapper('/users/1') }
        );
        await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

        // WS delivers order #31 and reports #1 as canonically evicted — no
        // cache entry exists yet for ['orders', 1] (the fetch above hasn't
        // resolved), so this buffers #31 and records a pending-removal tombstone.
        const ORDER_31 = { id: 31, userId: 1, total: 42 };
        MockWebSocket.latest().emit({ type: 'order-update', payload: ORDER_31, removedOrderIds: [1] });

        // The HTTP fetch — sent before the eviction happened server-side —
        // now resolves with a snapshot that still includes the evicted order #1.
        const ORDER_1 = { id: 1, userId: 1, total: 100 };
        const ORDER_2 = { id: 2, userId: 1, total: 5 };
        resolveOrders([ORDER_1, ORDER_2]);

        await waitFor(() => expect(result.current.orders.some((o) => o.id === 31)).toBe(true));

        const ids = result.current.orders.map((o) => o.id).sort((a, b) => a - b);
        expect(ids).toEqual([2, 31]); // #1 absent, #31 present
        expect(result.current.orders.filter((o) => o.id === 31)).toHaveLength(1); // no duplicates
        expect(result.current.orders).toHaveLength(2); // matches canonical retained count
      }
    );
  });
});
