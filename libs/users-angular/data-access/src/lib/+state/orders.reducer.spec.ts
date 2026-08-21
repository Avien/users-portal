import { Order } from '@portal/users/utils';
import { ordersAdapter, ordersReducer, initialOrdersState } from './orders.reducer';
import { UsersActions } from './users.actions';

const ORDER_101: Order = { id: 101, userId: 1, total: 120.5, status: 'completed' };
const ORDER_102: Order = { id: 102, userId: 1, total: 79.9, status: 'pending' };

describe('ordersReducer', () => {
  it('loadUserOrdersSuccess upserts the fetched orders into entity state', () => {
    const state = ordersReducer(
      initialOrdersState,
      UsersActions.loadUserOrdersSuccess({ userId: 1, orders: [ORDER_101, ORDER_102] })
    );

    expect(ordersAdapter.getSelectors().selectAll(state)).toEqual([ORDER_101, ORDER_102]);
    expect(state.loadedUserIds).toEqual([1]);
    expect(state.loading).toBe(false);
    expect(state.loaded).toBe(true);
  });

  it('a WS order that arrives before the HTTP load completes is not lost by the subsequent load', () => {
    // ordersUpdatedFromStream fires first (WS delta beat the HTTP response) —
    // this is the initial-load/WS race the source-of-truth fix must not break.
    const afterStream = ordersReducer(
      initialOrdersState,
      UsersActions.ordersUpdatedFromStream({ order: { id: 103, userId: 1, total: 42, status: 'pending' } })
    );

    const afterLoad = ordersReducer(
      afterStream,
      UsersActions.loadUserOrdersSuccess({ userId: 1, orders: [ORDER_101, ORDER_102] })
    );

    const all = ordersAdapter.getSelectors().selectAll(afterLoad);
    expect(all.map((o) => o.id).sort()).toEqual([101, 102, 103]);
  });

  it('duplicate ids from loadUserOrdersSuccess are upserted, not duplicated', () => {
    const afterFirstLoad = ordersReducer(
      initialOrdersState,
      UsersActions.loadUserOrdersSuccess({ userId: 1, orders: [ORDER_101] })
    );

    const updatedOrder101: Order = { ...ORDER_101, status: 'cancelled' };
    const afterSecondLoad = ordersReducer(
      afterFirstLoad,
      UsersActions.loadUserOrdersSuccess({ userId: 1, orders: [updatedOrder101] })
    );

    const all = ordersAdapter.getSelectors().selectAll(afterSecondLoad);
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('cancelled');
  });

  it('ordersUpdatedFromStream upserts by id instead of appending a duplicate', () => {
    const afterLoad = ordersReducer(
      initialOrdersState,
      UsersActions.loadUserOrdersSuccess({ userId: 1, orders: [ORDER_101] })
    );

    // Same id arrives again over the WS (REST snapshot vs. WS race) — must not duplicate.
    const afterStream = ordersReducer(
      afterLoad,
      UsersActions.ordersUpdatedFromStream({ order: ORDER_101 })
    );

    const all = ordersAdapter.getSelectors().selectAll(afterStream);
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(ORDER_101);
  });
});
