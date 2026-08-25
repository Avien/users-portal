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
  drainPendingRemovedIds,
} from '@portal/users-vue/data-access';

// Per-field refs. The VM is entirely derived, so each field is a ComputedRef —
// the precise, destructure-safe form of ToRefs<UserOrdersVm>. Interaction methods
// are plain functions (from IUsersFacadeInteractions).
type UsersFacade = {
  [K in keyof UserOrdersVm]: ComputedRef<UserOrdersVm[K]>;
} & IUsersFacadeInteractions;

// Live WebSocket order visual feedback (Post-production / Portfolio Polish,
// see docs/roadmap.md) — deliberately NOT folded into UserOrdersVm: it's
// ephemeral presentation state, not part of the shared cross-framework VM
// contract (mirrors the Angular facade's separate $recentlyArrivedOrderIds /
// $unseenOrderCountsByUserId signals).
type LiveOrderFeedback = {
  recentlyArrivedOrderIds: ComputedRef<ReadonlySet<number>>;
  unseenOrderCountsByUserId: ComputedRef<Readonly<Record<number, number>>>;
};

export function useUsersFacade(): UsersFacade & LiveOrderFeedback {
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
  //
  // The HTTP fetch now reads the same canonical live store those WS orders
  // came from, so it can race and already include some of them — merge by id
  // rather than assuming the pending buffer is always strictly new. Unlike
  // React's drain merge (which keeps the HTTP version on a collision), the WS
  // payload wins here since it's the more recent observation of that order;
  // pending-only orders are appended, and existing ordering is preserved.
  //
  // Also reconciles pending canonical-store evictions (removedOrderIds) that
  // arrived over WS before this fetch resolved: that fetch was already in
  // flight when the eviction happened server-side, so its result can still
  // contain the now-evicted order (the WS-before-HTTP hydration race) —
  // filtering removedIds out of `prev` (the fetch result) BEFORE the merge
  // below is what closes that gap.
  watch(
    [() => ordersQuery.isSuccess.value, () => selectedUserId.value],
    ([isSuccess, userId]) => {
      if (!isSuccess || userId === null) return;
      const removedIds = drainPendingRemovedIds(userId);
      const pending = drainPendingOrders(userId);
      if (pending.length === 0 && removedIds.size === 0) return;
      queryClient.setQueryData<Order[]>(['orders', userId], (prev) => {
        if (!prev) return pending;
        const withoutEvicted = removedIds.size > 0 ? prev.filter((order) => !removedIds.has(order.id)) : prev;
        // Map collapses same-id duplicates within `pending` itself to the last
        // (latest) occurrence — deriving pendingOnly from its values, not the
        // raw `pending` array, is what keeps a pending-only id that arrived
        // twice over WS before this drain to exactly one order.
        const pendingById = new Map(pending.map((order) => [order.id, order]));
        const merged = withoutEvicted.map((order) => pendingById.get(order.id) ?? order);
        const mergedIds = new Set(withoutEvicted.map((order) => order.id));
        const pendingOnly = [...pendingById.values()].filter((order) => !mergedIds.has(order.id));
        return [...merged, ...pendingOnly];
      });
    },
    { immediate: true },
  );

  // Effect 3 — clear a user's unseen-order badge once they're selected.
  watch(
    selectedUserId,
    (userId) => {
      if (userId !== null) usersStore.clearUnseenOrderCount(userId);
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

    // ── Live order feedback ──
    recentlyArrivedOrderIds: computed(() => usersStore.recentlyArrivedOrderIds),
    unseenOrderCountsByUserId: computed(() => usersStore.unseenOrderCountsByUserId),
  };
}