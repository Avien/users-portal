import { Injectable, WritableSignal } from '@angular/core';

/**
 * Ephemeral, presentation-only UI state for the "a live WS order just
 * arrived" feedback (Post-production / Portfolio Polish — Live WebSocket
 * order visual feedback, see docs/roadmap.md). Owns ONLY the timer mechanics
 * for the newly-arrived-row highlight; the facade owns the writable signal
 * and decides (from the already-dispatched `ordersUpdatedFromStream` action)
 * when an id should be marked. Same split as OrderNotificationsService:
 * ids/timers/list mutations live here, the *rule* for when to call this
 * lives in the facade.
 *
 * Deliberately NOT NgRx store state — this never needs to survive a reducer
 * replay, appear in Redux DevTools, or be serializable; it is a pure
 * transient rendering concern, the same reasoning that keeps toast
 * notifications out of the store too.
 */
@Injectable({ providedIn: 'root' })
export class LiveOrderFeedbackService {
  // Matches the "2-3 seconds" spec — long enough to notice, short enough to
  // read as "just happened" rather than a lingering UI state.
  private static readonly HIGHLIGHT_DURATION_MS = 2500;

  private readonly highlightTimers = new Map<number, ReturnType<typeof setTimeout>>();

  /**
   * Marks `orderId` as recently-arrived and schedules it to clear itself
   * after HIGHLIGHT_DURATION_MS. Safe to call again for the same id (e.g. a
   * rapid re-arrival is not expected given retention semantics, but this
   * restarts the timer rather than leaking the old one either way).
   */
  markArrived(recentlyArrivedOrderIds: WritableSignal<ReadonlySet<number>>, orderId: number): void {
    const existingTimer = this.highlightTimers.get(orderId);
    if (existingTimer != null) {
      clearTimeout(existingTimer);
    }
    recentlyArrivedOrderIds.update((ids) => new Set(ids).add(orderId));
    const timerId = setTimeout(() => {
      this.highlightTimers.delete(orderId);
      recentlyArrivedOrderIds.update((ids) => {
        if (!ids.has(orderId)) return ids;
        const next = new Set(ids);
        next.delete(orderId);
        return next;
      });
    }, LiveOrderFeedbackService.HIGHLIGHT_DURATION_MS);
    this.highlightTimers.set(orderId, timerId);
  }

  /**
   * Immediately clears any of `orderIds` from the recently-arrived set and
   * cancels their pending auto-clear timers — called when the canonical
   * store evicts them (WS `removedOrderIds`) so a row highlight can never
   * outlive (or later resurrect stale styling for) an order that's already
   * gone from the retained set.
   */
  clearArrived(recentlyArrivedOrderIds: WritableSignal<ReadonlySet<number>>, orderIds: readonly number[]): void {
    if (orderIds.length === 0) return;
    for (const id of orderIds) {
      const timer = this.highlightTimers.get(id);
      if (timer != null) {
        clearTimeout(timer);
        this.highlightTimers.delete(id);
      }
    }
    recentlyArrivedOrderIds.update((ids) => {
      let changed = false;
      const next = new Set(ids);
      for (const id of orderIds) {
        if (next.delete(id)) changed = true;
      }
      return changed ? next : ids;
    });
  }

  /** Cancels every pending timer and empties the set — used on facade teardown. */
  clearAll(recentlyArrivedOrderIds: WritableSignal<ReadonlySet<number>>): void {
    for (const timer of this.highlightTimers.values()) {
      clearTimeout(timer);
    }
    this.highlightTimers.clear();
    recentlyArrivedOrderIds.set(new Set());
  }
}
