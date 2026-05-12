import { useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IUsersFacadeInteractions, UserOrdersVm, Order } from '@portal/users/utils';
import { buildUserTotalOrdersVm } from '@portal/users/utils';
import { fetchUsers, fetchOrdersByUser, useUsersStore, drainPendingOrders } from '@portal/users-react/data-access';

export function useUsersFacade(): UserOrdersVm & IUsersFacadeInteractions {
  const queryClient = useQueryClient();
  const { userId } = useParams<{ userId: string }>();
  const selectedUserId = userId ? Number(userId) : null;
  const navigate = useNavigate();
  const selectUser = useCallback((id: number) => navigate(`/users/${id}`), [navigate]);

  const notifications = useUsersStore((s) => s.notifications);
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

  // Auto-navigate to first user when users load and no userId in URL
  useEffect(() => {
    if (!userId && usersQuery.data && usersQuery.data.length > 0) {
      navigate(`/users/${usersQuery.data[0].id}`, { replace: true });
    }
  }, [usersQuery.data, userId, navigate]);

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
