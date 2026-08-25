import { setActivePinia, createPinia } from 'pinia';
import { useUsersStore } from './users.store';

describe('useUsersStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('adds a notification with a generated id and timestamp', () => {
    const store = useUsersStore();
    store.addNotification({ severity: 'warning', message: 'High-value order' });
    expect(store.notifications).toHaveLength(1);
    expect(store.notifications[0].id).toBeTruthy();
    expect(store.notifications[0].timestamp).toBeTypeOf('number');
  });

  it('auto-dismisses a warning after 10s and a critical after 20s', () => {
    const store = useUsersStore();
    store.addNotification({ severity: 'warning', message: 'w' });
    store.addNotification({ severity: 'critical', message: 'c' });
    vi.advanceTimersByTime(10_000);
    expect(store.notifications.map((n) => n.severity)).toEqual(['critical']);
    vi.advanceTimersByTime(10_000);
    expect(store.notifications).toHaveLength(0);
  });

  it('dismisses by id and clears its timer', () => {
    const store = useUsersStore();
    store.addNotification({ severity: 'critical', message: 'x' });
    const { id } = store.notifications[0];
    store.dismissNotification(id);
    expect(store.notifications).toHaveLength(0);
  });

  describe('live order feedback', () => {
    describe('markOrderArrived', () => {
      it('adds the id to recentlyArrivedOrderIds', () => {
        const store = useUsersStore();
        store.markOrderArrived(101);
        expect(store.recentlyArrivedOrderIds.has(101)).toBe(true);
      });

      it('clears itself after ~2.5s (the intended highlight duration)', () => {
        const store = useUsersStore();
        store.markOrderArrived(101);
        vi.advanceTimersByTime(2499);
        expect(store.recentlyArrivedOrderIds.has(101)).toBe(true);
        vi.advanceTimersByTime(1);
        expect(store.recentlyArrivedOrderIds.has(101)).toBe(false);
      });

      it('tracks multiple concurrently-arrived orders independently', () => {
        const store = useUsersStore();
        store.markOrderArrived(101);
        vi.advanceTimersByTime(1000);
        store.markOrderArrived(102);

        vi.advanceTimersByTime(1500);
        expect(store.recentlyArrivedOrderIds.has(101)).toBe(false);
        expect(store.recentlyArrivedOrderIds.has(102)).toBe(true);

        vi.advanceTimersByTime(1000);
        expect(store.recentlyArrivedOrderIds.has(102)).toBe(false);
      });

      it('restarts the timer if the same id arrives again before it clears', () => {
        const store = useUsersStore();
        store.markOrderArrived(101);
        vi.advanceTimersByTime(2000);
        store.markOrderArrived(101);

        vi.advanceTimersByTime(2000);
        expect(store.recentlyArrivedOrderIds.has(101)).toBe(true);

        vi.advanceTimersByTime(500);
        expect(store.recentlyArrivedOrderIds.has(101)).toBe(false);
      });
    });

    describe('clearArrivedOrders (retention eviction)', () => {
      it('immediately removes evicted ids and cancels their pending timers', () => {
        const store = useUsersStore();
        store.markOrderArrived(101);
        store.clearArrivedOrders([101]);

        expect(store.recentlyArrivedOrderIds.has(101)).toBe(false);
        expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
        expect(store.recentlyArrivedOrderIds.has(101)).toBe(false);
      });

      it('leaves unrelated ids untouched', () => {
        const store = useUsersStore();
        store.markOrderArrived(101);
        store.markOrderArrived(102);
        store.clearArrivedOrders([101]);

        expect(store.recentlyArrivedOrderIds.has(101)).toBe(false);
        expect(store.recentlyArrivedOrderIds.has(102)).toBe(true);
      });

      it('is a safe no-op for an empty list', () => {
        const store = useUsersStore();
        store.markOrderArrived(101);
        const before = store.recentlyArrivedOrderIds;
        store.clearArrivedOrders([]);
        expect(store.recentlyArrivedOrderIds).toBe(before); // same reference — no unnecessary update
      });
    });

    describe('unseen order counts', () => {
      it('increments cleanly across multiple calls for the same user (+1, +2, ...)', () => {
        const store = useUsersStore();
        store.incrementUnseenOrderCount(2);
        store.incrementUnseenOrderCount(2);
        store.incrementUnseenOrderCount(2);

        expect(store.unseenOrderCountsByUserId).toEqual({ 2: 3 });
      });

      it('tracks counts per user independently', () => {
        const store = useUsersStore();
        store.incrementUnseenOrderCount(2);
        store.incrementUnseenOrderCount(3);
        store.incrementUnseenOrderCount(3);

        expect(store.unseenOrderCountsByUserId).toEqual({ 2: 1, 3: 2 });
      });

      it("clearUnseenOrderCount removes only that user's entry", () => {
        const store = useUsersStore();
        store.incrementUnseenOrderCount(2);
        store.incrementUnseenOrderCount(3);

        store.clearUnseenOrderCount(2);

        expect(store.unseenOrderCountsByUserId).toEqual({ 3: 1 });
      });

      it('clearUnseenOrderCount is a safe no-op for a user with no entry', () => {
        const store = useUsersStore();
        expect(() => store.clearUnseenOrderCount(99)).not.toThrow();
        expect(store.unseenOrderCountsByUserId).toEqual({});
      });
    });
  });
});