import { useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IUsersFacadeInteractions, UserOrdersVm, Order } from '@portal/users/utils';
import { buildUserTotalOrdersVm } from '@portal/users/utils';
import {
  fetchUsers,
  fetchOrdersByUser,
  useUsersStore,
  drainPendingOrders,
  drainPendingRemovedIds,
} from '@portal/users-react/data-access';

// Live WebSocket order visual feedback (Post-production / Portfolio Polish,
// see docs/roadmap.md) — deliberately NOT folded into UserOrdersVm: it's
// ephemeral presentation state, not part of the shared cross-framework VM
// contract (mirrors the Angular facade's separate $recentlyArrivedOrderIds /
// $unseenOrderCountsByUserId signals).
interface LiveOrderFeedbackVm {
  recentlyArrivedOrderIds: ReadonlySet<number>;
  unseenOrderCountsByUserId: Readonly<Record<number, number>>;
}

export function useUsersFacade(): UserOrdersVm & IUsersFacadeInteractions & LiveOrderFeedbackVm {
  const queryClient = useQueryClient();
  const { userId } = useParams<{ userId: string }>();
  const selectedUserId = userId ? Number(userId) : null;
  const navigate = useNavigate();
  const selectUser = useCallback((id: number) => navigate(`/users/${id}`), [navigate]);

  const notifications = useUsersStore((s) => s.notifications);
  const dismissNotification = useUsersStore((s) => s.dismissNotification);
  const recentlyArrivedOrderIds = useUsersStore((s) => s.recentlyArrivedOrderIds);
  const unseenOrderCountsByUserId = useUsersStore((s) => s.unseenOrderCountsByUserId);

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  });

  const ordersQuery = useQuery({
    queryKey: ['orders', selectedUserId],
    queryFn: () => fetchOrdersByUser(selectedUserId!),
    enabled: selectedUserId !== null,
    staleTime: Infinity,
  });

  const selectedUser = useMemo(
    () => usersQuery.data?.find((u) => u.id === selectedUserId) ?? null,
    [usersQuery.data, selectedUserId]
  );

  const selectedUserSummary = useMemo(
    () => buildUserTotalOrdersVm(selectedUser, ordersQuery.data ?? []),
    [selectedUser, ordersQuery.data]
  );

  // Auto-navigate to first user when users load and no userId in URL
  useEffect(() => {
    if (!userId && usersQuery.data && usersQuery.data.length > 0) {
      navigate(`/users/${usersQuery.data[0].id}`, { replace: true });
    }
  }, [usersQuery.data, userId, navigate]);

  // Mirror the route-derived selectedUserId into the store so useOrdersStream
  // — mounted once at the App root, above this routed facade — can tell
  // whether an arriving WS order is for the user currently being looked at.
  // Also clears that user's unseen-order badge on selection, same as the
  // Angular/Vue equivalents.
  useEffect(() => {
    useUsersStore.getState().setSelectedUserId(selectedUserId);
    if (selectedUserId !== null) {
      useUsersStore.getState().clearUnseenOrderCount(selectedUserId);
    }
  }, [selectedUserId]);

  // Merge any WS orders that arrived before this user's API fetch completed.
  // The fetch now reads the same canonical live store those WS orders came
  // from, so it can race and already include some of them — dedupe by id
  // rather than assuming the buffer is always strictly new.
  //
  // Also reconciles pending canonical-store evictions (removedOrderIds) that
  // arrived over WS before this fetch resolved: that fetch was already in
  // flight when the eviction happened server-side, so its result can still
  // contain the now-evicted order (the WS-before-HTTP hydration race) —
  // filtering removedOrderIds out of `prev` (the fetch result) BEFORE
  // merging the pending orders is what closes that gap.
  useEffect(() => {
    if (!ordersQuery.isSuccess || selectedUserId === null) return;
    const removedIds = drainPendingRemovedIds(selectedUserId);
    const pending = drainPendingOrders(selectedUserId);
    if (pending.length === 0 && removedIds.size === 0) return;
    queryClient.setQueryData<Order[]>(['orders', selectedUserId], (prev) => {
      if (!prev) return pending;
      const withoutEvicted = removedIds.size > 0 ? prev.filter((o) => !removedIds.has(o.id)) : prev;
      const existingIds = new Set(withoutEvicted.map((o) => o.id));
      const newOnes = pending.filter((o) => !existingIds.has(o.id));
      return newOnes.length > 0 ? [...withoutEvicted, ...newOnes] : withoutEvicted;
    });
  }, [ordersQuery.isSuccess, selectedUserId, queryClient]);

  return {
    users: usersQuery.data ?? [],
    loading: usersQuery.isLoading || ordersQuery.isLoading,
    loaded: usersQuery.isSuccess,
    error: usersQuery.error ? String(usersQuery.error) : null,
    orders: ordersQuery.data ?? [],
    selectedUserId,
    selectedUserSummary,
    notifications,
    selectUser,
    dismissOrderNotification: dismissNotification,
    recentlyArrivedOrderIds,
    unseenOrderCountsByUserId,
  };
}
