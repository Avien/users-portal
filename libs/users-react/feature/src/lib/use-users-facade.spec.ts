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
    useUsersStore.setState({ notifications: [] });
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
});
