import { Order } from '../models/order.interface';
import { User } from '../models/user.interface';

const o = (id: number, userId: number, total: number): Order => ({ id, userId, total, status: 'completed' });
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
      expect(isSuspiciousHighValueOrder(o(1, 1, SUSPICIOUS_ORDER_TOTAL_THRESHOLD))).toBe(true);
    });

    it('returns false when total is below the threshold', () => {
      expect(isSuspiciousHighValueOrder(o(1, 1, SUSPICIOUS_ORDER_TOTAL_THRESHOLD - 0.01))).toBe(false);
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
      const orders: Order[] = [o(101, 1, 10)];

      const { next, toastPayloads } = reduceOrderMonitoring(prev, orders, users, {
        now: 1_000_000,
        burstWindowMs: ORDER_BURST_WINDOW_MS
      });

      expect(toastPayloads).toEqual([]);
      expect(next.fingerprintsByOrderId.get(101)).toBe('1|10');
    });

    it('emits a warning when a single new order crosses the high-value threshold', () => {
      let state = createOrderMonitoringState();
      state = reduceOrderMonitoring(state, [o(101, 1, 10)], users, {
        now: 1_000_000,
        burstWindowMs: ORDER_BURST_WINDOW_MS
      }).next;

      const { toastPayloads } = reduceOrderMonitoring(
        state,
        [o(101, 1, 10), o(102, 1, 600)],
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
      state = reduceOrderMonitoring(state, [o(101, 1, 10)], users, {
        now: 1_000_000,
        burstWindowMs: ORDER_BURST_WINDOW_MS
      }).next;

      const { toastPayloads } = reduceOrderMonitoring(
        state,
        [o(101, 1, 10), o(102, 1, 20), o(103, 1, 30)],
        users,
        { now: 1_000_200, burstWindowMs: ORDER_BURST_WINDOW_MS }
      );

      expect(toastPayloads).toEqual([]);
    });

    it('emits critical burst when two arrivals fall inside the window', () => {
      let state = createOrderMonitoringState();
      state = reduceOrderMonitoring(state, [o(101, 1, 10)], users, {
        now: 1_000_000,
        burstWindowMs: 120_000
      }).next;

      state = reduceOrderMonitoring(
        state,
        [o(101, 1, 10), o(102, 1, 20)],
        users,
        { now: 1_000_010, burstWindowMs: 120_000 }
      ).next;

      const { toastPayloads } = reduceOrderMonitoring(
        state,
        [o(101, 1, 10), o(102, 1, 20), o(103, 1, 30)],
        users,
        { now: 1_000_020, burstWindowMs: 120_000 }
      );

      expect(toastPayloads.some((p) => p.severity === 'critical')).toBe(true);
    });

    it('attributes a high-value toast to order.userId even when the order id has crossed into another user\'s former id range', () => {
      // allocateNewId (tools/mock-orders-ws-server.mjs) is monotonic per user with
      // no wraparound — a long-lived user 1 can receive an id like 205, which used
      // to "belong" to user 2 under an id-range convention. The toast must still
      // name user 1 (order.userId), not user 2 (an id-derived reinterpretation).
      const usersById: User[] = [
        { id: 1, name: 'Avi Cohen' },
        { id: 2, name: 'Dana Levi' }
      ];
      let state = createOrderMonitoringState();
      state = reduceOrderMonitoring(state, [o(101, 1, 10)], usersById, {
        now: 1_000_000,
        burstWindowMs: ORDER_BURST_WINDOW_MS
      }).next;

      const crossedRangeOrder = o(205, 1, 600); // id looks like user 2's range; userId says 1
      const { toastPayloads } = reduceOrderMonitoring(
        state,
        [o(101, 1, 10), crossedRangeOrder],
        usersById,
        { now: 1_000_100, burstWindowMs: ORDER_BURST_WINDOW_MS }
      );

      expect(toastPayloads).toEqual([
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('Avi Cohen') as unknown as string
        })
      ]);
    });
  });
});
