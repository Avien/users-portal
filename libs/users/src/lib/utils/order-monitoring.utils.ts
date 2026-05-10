import { Notification } from '../models/notification.model';
import { Order } from '../models/order.interface';
import { User } from '../models/user.interface';
import { normalizeOrderUserIdFromId } from './user-orders.utils';

/** Orders at or above this total trigger a high-value monitoring toast. */
export const SUSPICIOUS_ORDER_TOTAL_THRESHOLD = 500;

/** Default window for burst order arrivals for the same user (milliseconds). */
export const ORDER_BURST_WINDOW_MS = 120_000;

export function isSuspiciousHighValueOrder(order: Order): boolean {
  return order.total >= SUSPICIOUS_ORDER_TOTAL_THRESHOLD;
}

/**
 * Returns true when at least two arrival timestamps for the same user fall
 * inside `[now - windowMs, now]`.
 */
export function isSecondOrderWithinBurstWindow(
  timestamps: readonly number[],
  windowMs: number,
  now: number
): boolean {
  const inWindow = timestamps.filter((t) => now - t <= windowMs);
  return inWindow.length >= 2;
}

export type OrderMonitoringToastPayload = Omit<Notification, 'id' | 'timestamp'>;

/**
 * Snapshot for diffing streamed/API order collections. Pure reducer returns a fresh snapshot.
 */
export type OrderMonitoringState = {
  fingerprintsByOrderId: Map<number, string>;
  recentArrivalsAtByUserId: Map<number, number[]>;
};

export function createOrderMonitoringState(): OrderMonitoringState {
  return {
    fingerprintsByOrderId: new Map(),
    recentArrivalsAtByUserId: new Map()
  };
}

function resolveUserLabel(users: readonly User[], userId: number): string {
  const user = users.find((u) => u.id === userId);
  return user?.name ?? `user ${userId}`;
}

function fingerprint(order: Order): string {
  return `${order.userId}|${order.total}`;
}

function cloneRecentArrivals(from: ReadonlyMap<number, readonly number[]>): Map<number, number[]> {
  const next = new Map<number, number[]>();
  for (const [userId, ts] of from) {
    next.set(userId, [...ts]);
  }
  return next;
}

/** Ids that exist in `next` but not in `previous` (new rows this tick). */
function newOrderIds(previous: ReadonlyMap<number, unknown>, next: ReadonlyMap<number, unknown>): number[] {
  const ids: number[] = [];
  for (const id of next.keys()) {
    if (!previous.has(id)) {
      ids.push(id);
    }
  }
  return ids;
}

function recordArrival(recent: Map<number, number[]>, userId: number, now: number): number[] {
  const timestamps = recent.get(userId) ?? [];
  timestamps.push(now);
  while (timestamps.length > 5) {
    timestamps.shift();
  }
  recent.set(userId, timestamps);
  return timestamps;
}

function monitoringResult(
  fingerprints: Map<number, string>,
  recent: Map<number, number[]>,
  toastPayloads: OrderMonitoringToastPayload[]
): { next: OrderMonitoringState; toastPayloads: OrderMonitoringToastPayload[] } {
  return {
    next: { fingerprintsByOrderId: fingerprints, recentArrivalsAtByUserId: recent },
    toastPayloads
  };
}

/**
 * Pure reducer: previous monitoring snapshot + current orders and users → next snapshot + toast payloads.
 *
 * **What it does (in order):**
 *
 * 1. **Fingerprint snapshot** — For every current order id, store `userId|total` (after normalization).
 *    That is the baseline we diff against next time.
 *
 * 2. **First run** — If we have no previous snapshot yet, we only *learn* the current ids (no toasts).
 *    That avoids treating the initial API load as a stream of “new” orders.
 *
 * 3. **What counts as “new” this tick** — Order ids that appear in the new snapshot but not the old one.
 *
 * 4. **Bulk-load guard** — If more than one new id appears in a *single* tick, we assume a batch
 *    (e.g. lazy `getOrdersByUserId`) and emit **no** toasts. Live stream updates are modeled as one id per tick.
 *
 * 5. **Single new order** — Optionally emit a **high-value** warning, append `now` to that user’s recent
 *    arrival list (capped), then optionally emit a **burst** critical if two arrivals fall in the window.
 */
export function reduceOrderMonitoring(
  prev: OrderMonitoringState,
  orders: readonly Order[],
  users: readonly User[],
  options: { now: number; burstWindowMs: number }
): { next: OrderMonitoringState; toastPayloads: OrderMonitoringToastPayload[] } {
  const normalizedOrders = orders.map((o) => normalizeOrderUserIdFromId(o));
  const nextFingerprints = new Map(normalizedOrders.map((o) => [o.id, fingerprint(o)]));
  const nextRecent = cloneRecentArrivals(prev.recentArrivalsAtByUserId);
  const { now, burstWindowMs } = options;

  if (prev.fingerprintsByOrderId.size === 0) {
    return monitoringResult(nextFingerprints, nextRecent, []);
  }

  const addedIds = newOrderIds(prev.fingerprintsByOrderId, nextFingerprints);
  if (addedIds.length !== 1) {
    return monitoringResult(nextFingerprints, nextRecent, []);
  }

  const newOrder = normalizedOrders.find((o) => o.id === addedIds[0]);
  if (!newOrder) {
    return monitoringResult(nextFingerprints, nextRecent, []);
  }

  const toastPayloads: OrderMonitoringToastPayload[] = [];
  const userLabel = resolveUserLabel(users, newOrder.userId);

  if (isSuspiciousHighValueOrder(newOrder)) {
    toastPayloads.push({
      severity: 'warning',
      message: `Order #${newOrder.id} for ${userLabel} exceeds $${SUSPICIOUS_ORDER_TOTAL_THRESHOLD} (total ${newOrder.total.toFixed(2)}).`
    });
  }

  const timestamps = recordArrival(nextRecent, newOrder.userId, now);
  if (isSecondOrderWithinBurstWindow(timestamps, burstWindowMs, now)) {
    const windowMinutes = Math.round(burstWindowMs / 60_000);
    toastPayloads.push({
      severity: 'critical',
      message: `${userLabel} received multiple new orders within ${windowMinutes} minutes.`
    });
  }

  return monitoringResult(nextFingerprints, nextRecent, toastPayloads);
}
