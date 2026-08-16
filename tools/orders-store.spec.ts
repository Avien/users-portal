import { describe, it, expect } from 'vitest';
import { createOrdersStore } from './orders-store.mjs';

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
});
