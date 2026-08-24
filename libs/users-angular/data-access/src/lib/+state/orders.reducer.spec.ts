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
      UsersActions.ordersUpdatedFromStream({
        order: { id: 103, userId: 1, total: 42, status: 'pending' },
        removedOrderIds: [],
      })
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
      UsersActions.ordersUpdatedFromStream({ order: ORDER_101, removedOrderIds: [] })
    );

    const all = ordersAdapter.getSelectors().selectAll(afterStream);
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(ORDER_101);
  });

  describe('ordersUpdatedFromStream — canonical retention eviction propagation', () => {
    it('removes canonically-evicted orders before upserting the incoming order', () => {
      const afterLoad = ordersReducer(
        initialOrdersState,
        UsersActions.loadUserOrdersSuccess({ userId: 1, orders: [ORDER_101, ORDER_102] })
      );

      const NEW_ORDER: Order = { id: 999, userId: 1, total: 5, status: 'pending' };
      const afterStream = ordersReducer(
        afterLoad,
        UsersActions.ordersUpdatedFromStream({ order: NEW_ORDER, removedOrderIds: [101] })
      );

      const all = ordersAdapter.getSelectors().selectAll(afterStream);
      expect(all.map((o) => o.id).sort((a, b) => a - b)).toEqual([102, 999]);
    });

    it('leaves entity state unchanged (beyond the upsert) when removedOrderIds is empty', () => {
      const afterLoad = ordersReducer(
        initialOrdersState,
        UsersActions.loadUserOrdersSuccess({ userId: 1, orders: [ORDER_101, ORDER_102] })
      );

      const NEW_ORDER: Order = { id: 999, userId: 1, total: 5, status: 'pending' };
      const afterStream = ordersReducer(
        afterLoad,
        UsersActions.ordersUpdatedFromStream({ order: NEW_ORDER, removedOrderIds: [] })
      );

      const all = ordersAdapter.getSelectors().selectAll(afterStream);
      expect(all.map((o) => o.id).sort((a, b) => a - b)).toEqual([101, 102, 999]);
    });

    it('the connected client cannot grow beyond the canonical retained count across repeated evicting updates', () => {
      let state = ordersReducer(
        initialOrdersState,
        UsersActions.loadUserOrdersSuccess({ userId: 1, orders: [ORDER_101, ORDER_102] })
      );

      // Three more updates arrive, each evicting the (now) oldest retained id —
      // simulates a long-lived connection receiving repeated retention evictions.
      state = ordersReducer(
        state,
        UsersActions.ordersUpdatedFromStream({
          order: { id: 1001, userId: 1, total: 1, status: 'pending' },
          removedOrderIds: [101],
        })
      );
      state = ordersReducer(
        state,
        UsersActions.ordersUpdatedFromStream({
          order: { id: 1002, userId: 1, total: 1, status: 'pending' },
          removedOrderIds: [102],
        })
      );
      state = ordersReducer(
        state,
        UsersActions.ordersUpdatedFromStream({
          order: { id: 1003, userId: 1, total: 1, status: 'pending' },
          removedOrderIds: [1001],
        })
      );

      const all = ordersAdapter.getSelectors().selectAll(state);
      expect(all).toHaveLength(2); // never grows past the canonical retained count
      expect(all.map((o) => o.id).sort((a, b) => a - b)).toEqual([1002, 1003]);
    });
  });

  describe('order.userId is authoritative regardless of order.id magnitude', () => {
    it('files a streamed order under order.userId even when its id has crossed into another user\'s former id range', () => {
      // Simulates long server uptime: allocateNewId (tools/mock-orders-ws-server.mjs)
      // is monotonic per user with no wraparound, so user 1's ids eventually cross
      // into what used to be user 2's "2xx" range. The order must still be filed
      // under its real userId (1), not an id-derived reinterpretation (2).
      const CROSSED_ORDER: Order = { id: 205, userId: 1, total: 42, status: 'pending' };

      const afterStream = ordersReducer(
        initialOrdersState,
        UsersActions.ordersUpdatedFromStream({ order: CROSSED_ORDER, removedOrderIds: [] })
      );

      const all = ordersAdapter.getSelectors().selectAll(afterStream);
      expect(all).toEqual([CROSSED_ORDER]);
      expect(all[0].userId).toBe(1);
    });

    it('does not let a crossed-range order leak into another user\'s loaded/selected orders', () => {
      const afterLoadUser2 = ordersReducer(
        initialOrdersState,
        UsersActions.loadUserOrdersSuccess({ userId: 2, orders: [] })
      );

      // A user-1 order whose id (205) falls in what used to be user 2's range.
      const CROSSED_ORDER: Order = { id: 205, userId: 1, total: 42, status: 'pending' };
      const afterStream = ordersReducer(
        afterLoadUser2,
        UsersActions.ordersUpdatedFromStream({ order: CROSSED_ORDER, removedOrderIds: [] })
      );

      const all = ordersAdapter.getSelectors().selectAll(afterStream);
      const user2Orders = all.filter((o) => o.userId === 2);
      expect(user2Orders).toEqual([]); // never attributed to user 2 just because id looks like it
    });
  });

  describe('WS-before-HTTP hydration race — pending eviction reconciliation', () => {
    it('a WS eviction that arrives before this user has ever loaded is held as a tombstone, then reconciled once loadUserOrdersSuccess resolves — even though the (stale, in-flight-before-the-eviction) HTTP snapshot still contains the evicted order', () => {
      const NEW_ORDER: Order = { id: 199, userId: 1, total: 5, status: 'pending' };

      // WS arrives FIRST — user 1 has never loaded (loadedUserIds is empty),
      // so removeMany([101]) here would be a no-op anyway (101 doesn't exist
      // in entity state yet). The eviction must be held, not discarded.
      const afterStream = ordersReducer(
        initialOrdersState,
        UsersActions.ordersUpdatedFromStream({ order: NEW_ORDER, removedOrderIds: [101] })
      );

      expect(afterStream.pendingEvictedIdsByUserId[1]).toEqual([101]);
      expect(ordersAdapter.getSelectors().selectAll(afterStream).map((o) => o.id)).toEqual([199]);

      // The HTTP request for user 1 was already in flight before the eviction
      // happened server-side, so its response still includes order 101.
      const afterLoad = ordersReducer(
        afterStream,
        UsersActions.loadUserOrdersSuccess({ userId: 1, orders: [ORDER_101, ORDER_102] })
      );

      const all = ordersAdapter.getSelectors().selectAll(afterLoad);
      expect(all.map((o) => o.id).sort((a, b) => a - b)).toEqual([102, 199]); // 101 absent, 199 present
      expect(all.filter((o) => o.id === 199)).toHaveLength(1); // no duplicates
      expect(afterLoad.pendingEvictedIdsByUserId[1]).toBeUndefined(); // tombstone cleared after reconciliation
      expect(afterLoad.loadedUserIds).toEqual([1]);
    });
  });
});
