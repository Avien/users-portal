import { describe, it, expect } from 'vitest';
import { createOrdersStore, MAX_ORDERS_PER_USER } from './orders-store.mjs';

// Each test creates its own store instance via createOrdersStore(...) instead
// of touching the runtime singleton (`ordersStore`) — full isolation, no
// mutation leaking between tests, no dependency on test execution order.

const SEED = [
  { id: 1, userId: 1, total: 10, status: 'completed' },
  { id: 2, userId: 2, total: 20, status: 'pending' },
];

describe('orders-store', () => {
  it('seeds with the provided orders', () => {
    const store = createOrdersStore(SEED);
    expect(store.getOrders()).toEqual(SEED);
  });

  it('makes a newly-added order immediately visible', () => {
    const store = createOrdersStore(SEED);
    store.addOrder({ id: 3, userId: 1, total: 42, status: 'completed' });
    const orders = store.getOrders();
    expect(orders).toHaveLength(SEED.length + 1);
    expect(orders.find((o) => o.id === 3)).toEqual({ id: 3, userId: 1, total: 42, status: 'completed' });
  });

  it('records an arrival timestamp for a dynamically added order', () => {
    const store = createOrdersStore(SEED);
    const before = Date.now();
    store.addOrder({ id: 3, userId: 1, total: 42, status: 'completed' });
    const { arrivals } = store.getSnapshot();
    expect(arrivals[3]).toBeGreaterThanOrEqual(before);
  });

  it('does not leak arrival metadata onto the Order object itself', () => {
    const store = createOrdersStore(SEED);
    store.addOrder({ id: 3, userId: 1, total: 42, status: 'completed' });
    const stored = store.getOrders().find((o) => o.id === 3);
    expect(stored).toEqual({ id: 3, userId: 1, total: 42, status: 'completed' });
  });

  it('does not record arrival metadata for seed orders', () => {
    const store = createOrdersStore(SEED);
    const { arrivals } = store.getSnapshot();
    expect(arrivals[1]).toBeUndefined();
    expect(arrivals[2]).toBeUndefined();
  });

  it('getSnapshot().orders matches getOrders() — one consistent read', () => {
    const store = createOrdersStore(SEED);
    store.addOrder({ id: 3, userId: 3, total: 5, status: 'pending' });
    const snapshot = store.getSnapshot();
    expect(snapshot.orders).toEqual(store.getOrders());
  });

  it('two independent store instances do not share state', () => {
    const storeA = createOrdersStore(SEED);
    const storeB = createOrdersStore(SEED);
    storeA.addOrder({ id: 99, userId: 1, total: 1, status: 'completed' });
    expect(storeA.getOrders().some((o) => o.id === 99)).toBe(true);
    expect(storeB.getOrders().some((o) => o.id === 99)).toBe(false);
  });

  describe('per-user retention', () => {
    function addNForUser(store, userId, count, { startId }) {
      for (let i = 0; i < count; i++) {
        store.addOrder({ id: startId + i, userId, total: 1, status: 'completed' });
      }
    }

    it('keeps all orders when a user is at or under the cap', () => {
      const store = createOrdersStore([]);
      addNForUser(store, 1, MAX_ORDERS_PER_USER, { startId: 1 });
      expect(store.getOrders()).toHaveLength(MAX_ORDERS_PER_USER);
    });

    it('the (MAX+1)th order for a user removes that user\'s oldest retained order', () => {
      const store = createOrdersStore([]);
      addNForUser(store, 1, MAX_ORDERS_PER_USER, { startId: 1 });
      store.addOrder({ id: 1000, userId: 1, total: 1, status: 'completed' });

      const idsForUser1 = store
        .getOrders()
        .filter((o) => o.userId === 1)
        .map((o) => o.id);

      expect(idsForUser1).toHaveLength(MAX_ORDERS_PER_USER);
      expect(idsForUser1).not.toContain(1); // oldest (id 1) evicted
      expect(idsForUser1).toContain(1000); // newest retained
      expect(idsForUser1).toContain(2); // next-oldest survives — only one evicted
    });

    it('retention is per-user, not global — another user is unaffected', () => {
      const store = createOrdersStore([]);
      addNForUser(store, 1, MAX_ORDERS_PER_USER, { startId: 1 });
      store.addOrder({ id: 2, userId: 2, total: 1, status: 'completed' });
      store.addOrder({ id: 1000, userId: 1, total: 1, status: 'completed' }); // pushes user 1 over the cap

      expect(store.getOrders().filter((o) => o.userId === 1)).toHaveLength(MAX_ORDERS_PER_USER);
      expect(store.getOrders().filter((o) => o.userId === 2)).toHaveLength(1);
      expect(store.getOrders().some((o) => o.id === 2 && o.userId === 2)).toBe(true);
    });

    it('removes arrival metadata for an evicted order, and no others', () => {
      const store = createOrdersStore([]);
      addNForUser(store, 1, MAX_ORDERS_PER_USER, { startId: 1 });
      store.addOrder({ id: 1000, userId: 1, total: 1, status: 'completed' });

      const { arrivals } = store.getSnapshot();
      expect(arrivals[1]).toBeUndefined(); // evicted order's arrival metadata gone
      expect(arrivals[2]).toBeDefined(); // surviving order's arrival metadata intact
      expect(arrivals[1000]).toBeDefined();
    });

    it('getSnapshot().orders and getOrders() expose the same retained set after eviction', () => {
      const store = createOrdersStore([]);
      addNForUser(store, 1, MAX_ORDERS_PER_USER, { startId: 1 });
      store.addOrder({ id: 1000, userId: 1, total: 1, status: 'completed' });

      expect(store.getSnapshot().orders).toEqual(store.getOrders());
    });

    it('the newest order remains available immediately after eviction (Business Agent tooling reads it)', () => {
      const store = createOrdersStore([]);
      addNForUser(store, 1, MAX_ORDERS_PER_USER, { startId: 1 });
      store.addOrder({ id: 1000, userId: 1, total: 42, status: 'completed' });

      expect(store.getOrders().find((o) => o.id === 1000)).toEqual({
        id: 1000,
        userId: 1,
        total: 42,
        status: 'completed',
      });
    });

    it('evicts exactly one oldest order per addOrder call, never more than the excess', () => {
      const store = createOrdersStore([]);
      addNForUser(store, 1, MAX_ORDERS_PER_USER + 5, { startId: 1 });
      // 5 orders over cap were added one at a time — each addOrder call should
      // only ever evict its own single excess, converging to exactly the cap.
      expect(store.getOrders().filter((o) => o.userId === 1)).toHaveLength(MAX_ORDERS_PER_USER);
    });

    describe('addOrder(...) return value — evictedOrderIds', () => {
      it('reports no evicted ids while a user is at or under the cap', () => {
        const store = createOrdersStore([]);
        let lastResult;
        for (let i = 0; i < MAX_ORDERS_PER_USER; i++) {
          lastResult = store.addOrder({ id: i + 1, userId: 1, total: 1, status: 'completed' });
        }
        expect(lastResult).toEqual({ evictedOrderIds: [] });
      });

      it('reports the oldest retained id as evicted on the (MAX+1)th order', () => {
        const store = createOrdersStore([]);
        addNForUser(store, 1, MAX_ORDERS_PER_USER, { startId: 1 });
        const result = store.addOrder({ id: 1000, userId: 1, total: 1, status: 'completed' });
        expect(result).toEqual({ evictedOrderIds: [1] });
      });

      it('does not report eviction ids for a different, unaffected user', () => {
        const store = createOrdersStore([]);
        addNForUser(store, 1, MAX_ORDERS_PER_USER, { startId: 1 }); // user 1 at cap
        const result = store.addOrder({ id: 2000, userId: 2, total: 1, status: 'completed' }); // user 2, first order
        expect(result).toEqual({ evictedOrderIds: [] });
      });
    });
  });
});
