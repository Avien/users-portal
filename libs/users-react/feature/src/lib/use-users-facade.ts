import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { IUsersFacadeInteractions, UserOrdersVm } from '@portal/users-angular/utils';
import { buildUserTotalOrdersVm } from '@portal/users-angular/utils';
import { fetchUsers, fetchOrdersByUser } from '@portal/users-react/data-access';

export function useUsersFacade(): UserOrdersVm & IUsersFacadeInteractions {
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  });

  const ordersQuery = useQuery({
    queryKey: ['orders', selectedUserId],
    queryFn: () => fetchOrdersByUser(selectedUserId!),
    enabled: selectedUserId !== null,
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
      setSelectedUserId(usersQuery.data[0].id);
    }
  }, [usersQuery.data, selectedUserId]);

  const selectUser = useCallback((id: number) => {
    setSelectedUserId(id);
  }, []);

  const dismissOrderNotification = useCallback((_id: string) => {
    // implemented when notifications + Zustand are introduced
  }, []);

  return {
    users: usersQuery.data ?? [],
    loading: usersQuery.isLoading,
    loaded: usersQuery.isSuccess,
    error: usersQuery.error ? String(usersQuery.error) : null,
    orders: ordersQuery.data ?? [],
    selectedUserId,
    selectedUserSummary,
    notifications: [],
    selectUser,
    dismissOrderNotification,
  };
}
