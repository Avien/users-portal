import { createFeatureSelector, createSelector } from '@ngrx/store';
import {
  buildUserTotalOrdersVm,
  getOrdersByUserId,
  Order,
  OrdersState,
  ORDERS_FEATURE_KEY,
  USERS_FEATURE_KEY,
  UserOrderSummary,
  UsersState
} from '@portal/users/utils';
import { ordersAdapter } from './orders.reducer';
import { usersAdapter } from './users.reducer';

const selectUsersState = createFeatureSelector<UsersState>(USERS_FEATURE_KEY);
const selectOrdersState = createFeatureSelector<OrdersState>(ORDERS_FEATURE_KEY);

const usersSelectors = usersAdapter.getSelectors();
const ordersSelectors = ordersAdapter.getSelectors();

const selectAllUsers = createSelector(selectUsersState, usersSelectors.selectAll);

const selectUsersEntities = createSelector(selectUsersState, usersSelectors.selectEntities);

const selectSelectedUserId = createSelector(selectUsersState, (state) => state.selectedUserId);

const selectAllOrders = createSelector(selectOrdersState, ordersSelectors.selectAll);

const selectSelectedUser = createSelector(
  selectUsersEntities,
  selectSelectedUserId,
  (entities, selectedUserId) => (selectedUserId == null ? null : (entities[selectedUserId] ?? null))
);

const selectSelectedUserOrders = createSelector(
  selectAllOrders,
  selectSelectedUserId,
  (orders, selectedUserId): Order[] => getOrdersByUserId(orders, selectedUserId)
);

const selectUserOrderSummary = createSelector(
  selectSelectedUser,
  selectSelectedUserOrders,
  (selectedUser, orders): UserOrderSummary | null => buildUserTotalOrdersVm(selectedUser, orders)
);

const selectUsersLoading = createSelector(selectUsersState, (state) => state.loading);

const selectUsersLoaded = createSelector(selectUsersState, (state) => state.loaded);

const selectUsersError = createSelector(selectUsersState, (state) => state.error);

const selectOrdersLoading = createSelector(selectOrdersState, (state) => state.loading);

const selectOrdersLoaded = createSelector(selectOrdersState, (state) => state.loaded);

const selectOrdersError = createSelector(selectOrdersState, (state) => state.error);

const selectLoadedUserOrderIds = createSelector(
  selectOrdersState,
  (state) => state?.loadedUserIds ?? []
);

const selectHasLoadedOrdersForUser = (userId: number) =>
  createSelector(selectLoadedUserOrderIds, (loadedUserIds) => loadedUserIds.includes(userId));

const selectLoading = createSelector(
  selectUsersLoading,
  selectOrdersLoading,
  (usersLoading, ordersLoading) => usersLoading || ordersLoading
);

const selectLoaded = createSelector(
  selectUsersLoaded,
  selectOrdersLoaded,
  (usersLoaded, ordersLoaded) => usersLoaded || ordersLoaded
);

const selectError = createSelector(
  selectUsersError,
  selectOrdersError,
  (usersError, ordersError) => usersError || ordersError
);

export const UsersSelectors = {
  selectAllUsers,
  selectAllOrders,
  selectSelectedUserId,
  selectLoadedUserOrderIds,
  selectHasLoadedOrdersForUser,
  selectSelectedUserOrders,
  selectUserOrderSummary,
  selectLoading,
  selectLoaded,
  selectError
};
