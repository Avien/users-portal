import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IUsersFacadeInteractions, UserOrdersVm, Order } from '@portal/users/utils';
import { buildUserTotalOrdersVm } from '@portal/users/utils';
import { fetchUsers, fetchOrdersByUser, useUsersStore, drainPendingOrders } from '@portal/users-react/data-access';

export function useUsersFacade(): UserOrdersVm & IUsersFacadeInteractions {
  const queryClient = useQueryClient();
  const selectedUserId = useUsersStore((s) => s.selectedUserId);
  const notifications = useUsersStore((s) => s.notifications);
  const selectUser = useUsersStore((s) => s.selectUser);
  const dismissNotification = useUsersStore((s) => s.dismissNotification);

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

  useEffect(() => {
    if (selectedUserId === null && usersQuery.data && usersQuery.data.length > 0) {
      selectUser(usersQuery.data[0].id);
    }
  }, [usersQuery.data, selectedUserId, selectUser]);

  // Merge any WS orders that arrived before this user's API fetch completed
  useEffect(() => {
    if (!ordersQuery.isSuccess || selectedUserId === null) return;
    const pending = drainPendingOrders(selectedUserId);
    if (pending.length === 0) return;
    queryClient.setQueryData<Order[]>(['orders', selectedUserId], (prev) =>
      prev ? [...prev, ...pending] : pending
    );
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
  };
}
