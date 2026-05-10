import { createEntityAdapter } from '@ngrx/entity';
import { createReducer, on } from '@ngrx/store';
import { Order, OrdersState, normalizeOrderUserIdFromId } from '@portal/users-angular/utils';
import { UsersActions } from './users.actions';

export const ordersAdapter = createEntityAdapter<Order>();

export const initialOrdersState: OrdersState = ordersAdapter.getInitialState({
  loading: false,
  loaded: false,
  error: null,
  loadedUserIds: []
});

export const ordersReducer = createReducer(
  initialOrdersState,

  on(UsersActions.loadUserOrders, (state) => ({
    ...state,
    loading: true,
    error: null
  })),

  /**
   * @action loadUserOrdersSuccess
   * @description
   * Merges API orders into the current entity state for the selected user.
   *
   * @why
   * WebSocket events may add new orders before the user's lazy API load completes.
   * We use `upsertMany` (without pre-removal) so WS-created orders are preserved,
   * while API-provided orders are inserted/updated by id.
   *
   * @note
   * This strategy prefers data retention (no accidental WS data loss) over strict
   * API snapshot replacement.
   */
  on(UsersActions.loadUserOrdersSuccess, (state, { userId, orders }) => {
    return ordersAdapter.upsertMany(orders, {
      ...state,
      loading: false,
      loaded: true,
      error: null,
      loadedUserIds: state.loadedUserIds.includes(userId)
        ? state.loadedUserIds
        : [...state.loadedUserIds, userId]
    });
  }),

  on(UsersActions.loadUserOrdersFailure, (state, { error }) => ({
    ...state,
    loading: false,
    loaded: false,
    error
  })),

  on(UsersActions.deleteUserSuccess, (state, { userId }) => {
    const deletedUserOrderIds = (state.ids as number[]).filter(
      (id) => state.entities[id]?.userId === userId
    );

    const stateAfterRemoval = ordersAdapter.removeMany(deletedUserOrderIds, state);

    return {
      ...stateAfterRemoval,
      loadedUserIds: stateAfterRemoval.loadedUserIds.filter((id) => id !== userId)
    };
  }),

  on(UsersActions.ordersUpdatedFromStream, (state, { order }) => {
    return ordersAdapter.upsertOne(normalizeOrderUserIdFromId(order), state);
  })
);
