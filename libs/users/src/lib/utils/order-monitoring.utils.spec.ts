import { Order } from '../models/order.interface';
import { User } from '../models/user.interface';
import {
  createOrderMonitoringState,
  isSecondOrderWithinBurstWindow,
  isSuspiciousHighValueOrder,
  ORDER_BURST_WINDOW_MS,
  reduceOrderMonitoring,
  SUSPICIOUS_ORDER_TOTAL_THRESHOLD
} from './order-monitoring.utils';

describe('order-monitoring.utils', () => {
  describe('isSuspiciousHighValueOrder', () => {
    it('returns true when total is at the configured threshold', () => {
      const order: Order = { id: 1, userId: 1, total: SUSPICIOUS_ORDER_TOTAL_THRESHOLD };
      expect(isSuspiciousHighValueOrder(order)).toBe(true);
    });

    it('returns false when total is below the threshold', () => {
      const order: Order = { id: 1, userId: 1, total: SUSPICIOUS_ORDER_TOTAL_THRESHOLD - 0.01 };
      expect(isSuspiciousHighValueOrder(order)).toBe(false);
    });
  });

  describe('isSecondOrderWithinBurstWindow', () => {
    it('returns false when fewer than two timestamps fall in the window', () => {
      const now = 1_000_000;
      expect(isSecondOrderWithinBurstWindow([now - 10_000], 120_000, now)).toBe(false);
    });

    it('returns true when two timestamps fall within the window', () => {
      const now = 1_000_000;
      expect(isSecondOrderWithinBurstWindow([now - 60_000, now], 120_000, now)).toBe(true);
    });

    it('ignores timestamps older than the window', () => {
      const now = 1_000_000;
      expect(isSecondOrderWithinBurstWindow([now - 200_000, now], 120_000, now)).toBe(false);
    });
  });

  describe('reduceOrderMonitoring', () => {
    const users: User[] = [{ id: 1, name: 'Avi Cohen' }];

    it('seeds fingerprints on first tick without emitting toasts', () => {
      const prev = createOrderMonitoringState();
      const orders: Order[] = [{ id: 101, userId: 1, total: 10 }];

      const { next, toastPayloads } = reduceOrderMonitoring(prev, orders, users, {
        now: 1_000_000,
        burstWindowMs: ORDER_BURST_WINDOW_MS
      });

      expect(toastPayloads).toEqual([]);
      expect(next.fingerprintsByOrderId.get(101)).toBe('1|10');
    });

    it('emits a warning when a single new order crosses the high-value threshold', () => {
      let state = createOrderMonitoringState();
      state = reduceOrderMonitoring(state, [{ id: 101, userId: 1, total: 10 }], users, {
        now: 1_000_000,
        burstWindowMs: ORDER_BURST_WINDOW_MS
      }).next;

      const { toastPayloads } = reduceOrderMonitoring(
        state,
        [
          { id: 101, userId: 1, total: 10 },
          { id: 102, userId: 1, total: 600 }
        ],
        users,
        { now: 1_000_100, burstWindowMs: ORDER_BURST_WINDOW_MS }
      );

      expect(toastPayloads).toEqual([
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('600.00') as unknown as string
        })
      ]);
    });

    it('does not emit when multiple new ids arrive in one tick (bulk load heuristic)', () => {
      let state = createOrderMonitoringState();
      state = reduceOrderMonitoring(state, [{ id: 101, userId: 1, total: 10 }], users, {
        now: 1_000_000,
        burstWindowMs: ORDER_BURST_WINDOW_MS
      }).next;

      const { toastPayloads } = reduceOrderMonitoring(
        state,
        [
          { id: 101, userId: 1, total: 10 },
          { id: 102, userId: 1, total: 20 },
          { id: 103, userId: 1, total: 30 }
        ],
        users,
        { now: 1_000_200, burstWindowMs: ORDER_BURST_WINDOW_MS }
      );

      expect(toastPayloads).toEqual([]);
    });

    it('emits critical burst when two arrivals fall inside the window', () => {
      let state = createOrderMonitoringState();
      state = reduceOrderMonitoring(state, [{ id: 101, userId: 1, total: 10 }], users, {
        now: 1_000_000,
        burstWindowMs: 120_000
      }).next;

      state = reduceOrderMonitoring(
        state,
        [
          { id: 101, userId: 1, total: 10 },
          { id: 102, userId: 1, total: 20 }
        ],
        users,
        { now: 1_000_010, burstWindowMs: 120_000 }
      ).next;

      const { toastPayloads } = reduceOrderMonitoring(
        state,
        [
          { id: 101, userId: 1, total: 10 },
          { id: 102, userId: 1, total: 20 },
          { id: 103, userId: 1, total: 30 }
        ],
        users,
        { now: 1_000_020, burstWindowMs: 120_000 }
      );

      expect(toastPayloads.some((p) => p.severity === 'critical')).toBe(true);
    });
  });
});
