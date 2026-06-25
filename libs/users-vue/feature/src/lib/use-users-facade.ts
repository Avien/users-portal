import { computed, watch, type ComputedRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import type { IUsersFacadeInteractions, UserOrdersVm, Order } from '@portal/users/utils';
import { buildUserTotalOrdersVm } from '@portal/users/utils';
import {
  fetchUsers,
  fetchOrdersByUser,
  useUsersStore,
  drainPendingOrders,
} from '@portal/users-vue/data-access';

// Per-field refs. The VM is entirely derived, so each field is a ComputedRef —
// the precise, destructure-safe form of ToRefs<UserOrdersVm>. Interaction methods
// are plain functions (from IUsersFacadeInteractions).
type UsersFacade = {
  [K in keyof UserOrdersVm]: ComputedRef<UserOrdersVm[K]>;
} & IUsersFacadeInteractions;

export function useUsersFacade(): UsersFacade {
  const route = useRoute();
  const router = useRouter();
  const queryClient = useQueryClient();
  const usersStore = useUsersStore();

  // Route-derived selection (route logic lives in the facade, not the component).
  const selectedUserId = computed<number | null>(() => {
    const id = route.params['userId'];
    return id ? Number(id) : null;
  });

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  });

  const ordersQuery = useQuery({
    queryKey: ['orders', selectedUserId],
    queryFn: () => fetchOrdersByUser(selectedUserId.value as number),
    enabled: computed(() => selectedUserId.value !== null),
    staleTime: Infinity,
  });

  const selectedUser = computed(
    () => usersQuery.data.value?.find((u) => u.id === selectedUserId.value) ?? null,
  );

  const selectedUserSummary = computed(() =>
    buildUserTotalOrdersVm(selectedUser.value, ordersQuery.data.value ?? []),
  );

  // Effect 1 — auto-navigate to the first user once users load and no userId in the URL.
  // (React: useEffect deps [usersQuery.data, userId]; immediate handles already-cached data.)
  watch(
    [() => usersQuery.data.value, () => route.params['userId']],
    ([users, userId]) => {
      if (!userId && Array.isArray(users) && users.length > 0) {
        router.replace(`/users/${users[0].id}`);
      }
    },
    { immediate: true },
  );

  // Effect 2 — merge WS orders that arrived before this user's fetch completed.
  // (React: useEffect deps [ordersQuery.isSuccess, selectedUserId].)
  watch(
    [() => ordersQuery.isSuccess.value, () => selectedUserId.value],
    ([isSuccess, userId]) => {
      if (!isSuccess || userId === null) return;
      const pending = drainPendingOrders(userId);
      if (pending.length === 0) return;
      queryClient.setQueryData<Order[]>(['orders', userId], (prev) =>
        prev ? [...prev, ...pending] : pending,
      );
    },
    { immediate: true },
  );

  return {
    // ── UserOrdersVm (per-field computed refs) ──
    users: computed(() => usersQuery.data.value ?? []),
    orders: computed(() => ordersQuery.data.value ?? []),
    selectedUserId,
    selectedUserSummary,
    notifications: computed(() => usersStore.notifications),
    loading: computed(() => usersQuery.isLoading.value || ordersQuery.isLoading.value),
    loaded: computed(() => usersQuery.isSuccess.value),
    error: computed(() => (usersQuery.error.value ? String(usersQuery.error.value) : null)),

    // ── IUsersFacadeInteractions ──
    selectUser: (id: number) => {
      router.push(`/users/${id}`);
    },
    dismissOrderNotification: usersStore.dismissNotification,
  };
}