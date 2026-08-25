// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useUsersStore } from './users.store';

// Focused on the NEW live-order-feedback additions (selectedUserId mirror,
// recentlyArrivedOrderIds, unseenOrderCountsByUserId) — pre-existing
// notification behavior already has its own coverage via use-orders-stream.spec.ts.
describe('useUsersStore — live order feedback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUsersStore.setState({
      selectedUserId: null,
      recentlyArrivedOrderIds: new Set(),
      unseenOrderCountsByUserId: {},
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('selectedUserId', () => {
    it('defaults to null and can be set', () => {
      expect(useUsersStore.getState().selectedUserId).toBeNull();
      useUsersStore.getState().setSelectedUserId(1);
      expect(useUsersStore.getState().selectedUserId).toBe(1);
    });
  });

  describe('markOrderArrived', () => {
    it('adds the id to recentlyArrivedOrderIds', () => {
      useUsersStore.getState().markOrderArrived(101);
      expect(useUsersStore.getState().recentlyArrivedOrderIds.has(101)).toBe(true);
    });

    it('clears itself after ~2.5s (the intended highlight duration)', () => {
      useUsersStore.getState().markOrderArrived(101);
      vi.advanceTimersByTime(2499);
      expect(useUsersStore.getState().recentlyArrivedOrderIds.has(101)).toBe(true);
      vi.advanceTimersByTime(1);
      expect(useUsersStore.getState().recentlyArrivedOrderIds.has(101)).toBe(false);
    });

    it('tracks multiple concurrently-arrived orders independently', () => {
      useUsersStore.getState().markOrderArrived(101);
      vi.advanceTimersByTime(1000);
      useUsersStore.getState().markOrderArrived(102);

      vi.advanceTimersByTime(1500);
      expect(useUsersStore.getState().recentlyArrivedOrderIds.has(101)).toBe(false);
      expect(useUsersStore.getState().recentlyArrivedOrderIds.has(102)).toBe(true);

      vi.advanceTimersByTime(1000);
      expect(useUsersStore.getState().recentlyArrivedOrderIds.has(102)).toBe(false);
    });

    it('restarts the timer if the same id arrives again before it clears', () => {
      useUsersStore.getState().markOrderArrived(101);
      vi.advanceTimersByTime(2000);
      useUsersStore.getState().markOrderArrived(101);

      vi.advanceTimersByTime(2000);
      expect(useUsersStore.getState().recentlyArrivedOrderIds.has(101)).toBe(true);

      vi.advanceTimersByTime(500);
      expect(useUsersStore.getState().recentlyArrivedOrderIds.has(101)).toBe(false);
    });
  });

  describe('clearArrivedOrders (retention eviction)', () => {
    it('immediately removes evicted ids and cancels their pending timers', () => {
      useUsersStore.getState().markOrderArrived(101);
      useUsersStore.getState().clearArrivedOrders([101]);

      expect(useUsersStore.getState().recentlyArrivedOrderIds.has(101)).toBe(false);
      expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
      expect(useUsersStore.getState().recentlyArrivedOrderIds.has(101)).toBe(false);
    });

    it('leaves unrelated ids untouched', () => {
      useUsersStore.getState().markOrderArrived(101);
      useUsersStore.getState().markOrderArrived(102);
      useUsersStore.getState().clearArrivedOrders([101]);

      expect(useUsersStore.getState().recentlyArrivedOrderIds.has(101)).toBe(false);
      expect(useUsersStore.getState().recentlyArrivedOrderIds.has(102)).toBe(true);
    });

    it('is a safe no-op for an empty list', () => {
      useUsersStore.getState().markOrderArrived(101);
      const before = useUsersStore.getState().recentlyArrivedOrderIds;
      useUsersStore.getState().clearArrivedOrders([]);
      expect(useUsersStore.getState().recentlyArrivedOrderIds).toBe(before); // same reference — no unnecessary update
    });
  });

  describe('unseen order counts', () => {
    it('increments cleanly across multiple calls for the same user (+1, +2, ...)', () => {
      useUsersStore.getState().incrementUnseenOrderCount(2);
      useUsersStore.getState().incrementUnseenOrderCount(2);
      useUsersStore.getState().incrementUnseenOrderCount(2);

      expect(useUsersStore.getState().unseenOrderCountsByUserId).toEqual({ 2: 3 });
    });

    it('tracks counts per user independently', () => {
      useUsersStore.getState().incrementUnseenOrderCount(2);
      useUsersStore.getState().incrementUnseenOrderCount(3);
      useUsersStore.getState().incrementUnseenOrderCount(3);

      expect(useUsersStore.getState().unseenOrderCountsByUserId).toEqual({ 2: 1, 3: 2 });
    });

    it('clearUnseenOrderCount removes only that user\'s entry', () => {
      useUsersStore.getState().incrementUnseenOrderCount(2);
      useUsersStore.getState().incrementUnseenOrderCount(3);

      useUsersStore.getState().clearUnseenOrderCount(2);

      expect(useUsersStore.getState().unseenOrderCountsByUserId).toEqual({ 3: 1 });
    });

    it('clearUnseenOrderCount is a safe no-op for a user with no entry', () => {
      expect(() => useUsersStore.getState().clearUnseenOrderCount(99)).not.toThrow();
      expect(useUsersStore.getState().unseenOrderCountsByUserId).toEqual({});
    });
  });
});
