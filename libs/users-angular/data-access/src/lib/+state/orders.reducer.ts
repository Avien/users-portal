import { createEntityAdapter } from '@ngrx/entity';
import { createReducer, on } from '@ngrx/store';
import { Order, OrdersState } from '@portal/users/utils';
import { UsersActions } from './users.actions';

export const ordersAdapter = createEntityAdapter<Order>();

export const initialOrdersState: OrdersState = ordersAdapter.getInitialState({
  loading: false,
  loaded: false,
  error: null,
  loadedUserIds: [],
  pendingEvictedIdsByUserId: {}
});

export const ordersReducer = createReducer(
  initialOrdersState,

  on(UsersActions.loadUserOrders, (state) => ({
    ...state,
    loading: true,
    error: null
  })),

  // Merges API orders into entity state for this user. upsertMany (no
  // pre-removal) preserves any WS-created orders that arrived before this
  // load completed, rather than replacing the set with the API snapshot.
  //
  // Also reconciles pending canonical-store evictions that arrived over WS
  // before this HTTP response resolved (the WS-before-HTTP hydration race —
  // see ordersUpdatedFromStream below): the response can still contain an
  // order the store has since evicted, so those tombstoned ids are removed
  // here, after the upsert, then cleared for this user.
  on(UsersActions.loadUserOrdersSuccess, (state, { userId, orders }) => {
    const pendingEvictedIds = state.pendingEvictedIdsByUserId[userId] ?? [];
    const stateAfterUpsert = ordersAdapter.upsertMany(orders, {
      ...state,
      loading: false,
      loaded: true,
      error: null,
      loadedUserIds: state.loadedUserIds.includes(userId)
        ? state.loadedUserIds
        : [...state.loadedUserIds, userId]
    });
    const stateAfterReconciliation =
      pendingEvictedIds.length > 0
        ? ordersAdapter.removeMany(pendingEvictedIds, stateAfterUpsert)
        : stateAfterUpsert;
    const remainingPendingEvictedIds = Object.fromEntries(
      Object.entries(stateAfterReconciliation.pendingEvictedIdsByUserId).filter(([id]) => Number(id) !== userId)
    );
    return { ...stateAfterReconciliation, pendingEvictedIdsByUserId: remainingPendingEvictedIds };
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

  // Removes canonically-evicted orders (see tools/orders-store.mjs's
  // MAX_ORDERS_PER_USER) for this user before upserting the incoming order,
  // so entity state stays converged with the canonical store's retained set.
  //
  // If this user hasn't loaded yet, removeMany would be a no-op here, and the
  // still-in-flight loadUserOrdersSuccess could later reintroduce the evicted
  // order from a stale snapshot — so the eviction is held as a tombstone
  // instead and reconciled once that HTTP response resolves (see above).
  on(UsersActions.ordersUpdatedFromStream, (state, { order, removedOrderIds }) => {
    // order.userId is authoritative for server-sourced orders — it is never
    // re-derived from order.id. The canonical store (tools/orders-store.mjs)
    // allocates ids monotonically per user with no wraparound, so an id-based
    // convention (e.g. "1xx -> user 1") only holds for a short window after
    // server startup; trusting it here would silently re-file long-lived
    // users' orders under the wrong userId once their ids cross that boundary.
    const userId = order.userId;
    const isHydratedForUser = state.loadedUserIds.includes(userId);

    let nextState = state;
    if (removedOrderIds.length > 0) {
      if (isHydratedForUser) {
        nextState = ordersAdapter.removeMany(removedOrderIds, nextState);
      } else {
        const existingTombstones = nextState.pendingEvictedIdsByUserId[userId] ?? [];
        nextState = {
          ...nextState,
          pendingEvictedIdsByUserId: {
            ...nextState.pendingEvictedIdsByUserId,
            [userId]: [...new Set([...existingTombstones, ...removedOrderIds])]
          }
        };
      }
    }
    return ordersAdapter.upsertOne(order, nextState);
  })
);
