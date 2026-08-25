import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Notification, NotificationSeverity } from '@portal/users/utils';

const AUTO_DISMISS_MS: Record<NotificationSeverity, number> = {
  warning: 10_000,
  critical: 20_000,
};

// Lives outside the store state — same pattern as Angular's
// OrderNotificationsService.dismissTimers and the React Zustand store's module-level Map.
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Live WebSocket order visual feedback (Post-production / Portfolio Polish,
// see docs/roadmap.md) — matches the "2-3 seconds" spec: long enough to
// notice, short enough to read as "just happened".
const HIGHLIGHT_DURATION_MS = 2500;
// Same pattern as dismissTimers above — timer handles are not store state.
const highlightTimers = new Map<number, ReturnType<typeof setTimeout>>();

// Pinia setup store — the idiomatic Vue equivalent of the React Zustand store
// (UI state only: notifications, live-order-feedback; selectedUserId lives in
// the URL via vue-router).
export const useUsersStore = defineStore('users', () => {
  const notifications = ref<Notification[]>([]);

  function dismissNotification(id: string): void {
    const timerId = dismissTimers.get(id);
    if (timerId != null) clearTimeout(timerId);
    dismissTimers.delete(id);
    notifications.value = notifications.value.filter((n) => n.id !== id);
  }

  function addNotification(payload: Omit<Notification, 'id' | 'timestamp'>): void {
    const id = crypto.randomUUID();
    const notification: Notification = { ...payload, id, timestamp: Date.now() };
    notifications.value = [...notifications.value, notification];
    const timerId = setTimeout(() => dismissNotification(id), AUTO_DISMISS_MS[payload.severity]);
    dismissTimers.set(id, timerId);
  }

  // Ephemeral presentation state only — never added to the shared Order model
  // or the WS wire contract in @portal/users/utils. Populated exclusively from
  // useOrdersStream's ws.onmessage (genuine WS arrivals); HTTP hydration
  // (fetchOrdersByUser) never touches either of these.
  const recentlyArrivedOrderIds = ref<ReadonlySet<number>>(new Set());

  function markOrderArrived(orderId: number): void {
    const existingTimer = highlightTimers.get(orderId);
    if (existingTimer != null) clearTimeout(existingTimer);
    recentlyArrivedOrderIds.value = new Set(recentlyArrivedOrderIds.value).add(orderId);
    const timerId = setTimeout(() => {
      highlightTimers.delete(orderId);
      if (!recentlyArrivedOrderIds.value.has(orderId)) return;
      const next = new Set(recentlyArrivedOrderIds.value);
      next.delete(orderId);
      recentlyArrivedOrderIds.value = next;
    }, HIGHLIGHT_DURATION_MS);
    highlightTimers.set(orderId, timerId);
  }

  // Called on canonical-store eviction (WS removedOrderIds) so a row highlight
  // can never outlive an order that's already gone from the retained set —
  // see the same rationale on Angular's LiveOrderFeedbackService.
  function clearArrivedOrders(orderIds: readonly number[]): void {
    if (orderIds.length === 0) return;
    for (const id of orderIds) {
      const timer = highlightTimers.get(id);
      if (timer != null) {
        clearTimeout(timer);
        highlightTimers.delete(id);
      }
    }
    let changed = false;
    const next = new Set(recentlyArrivedOrderIds.value);
    for (const id of orderIds) {
      if (next.delete(id)) changed = true;
    }
    if (changed) recentlyArrivedOrderIds.value = next;
  }

  const unseenOrderCountsByUserId = ref<Readonly<Record<number, number>>>({});

  function incrementUnseenOrderCount(userId: number): void {
    unseenOrderCountsByUserId.value = {
      ...unseenOrderCountsByUserId.value,
      [userId]: (unseenOrderCountsByUserId.value[userId] ?? 0) + 1,
    };
  }

  function clearUnseenOrderCount(userId: number): void {
    if (!(userId in unseenOrderCountsByUserId.value)) return;
    const next = { ...unseenOrderCountsByUserId.value };
    delete next[userId];
    unseenOrderCountsByUserId.value = next;
  }

  return {
    notifications,
    addNotification,
    dismissNotification,
    recentlyArrivedOrderIds,
    markOrderArrived,
    clearArrivedOrders,
    unseenOrderCountsByUserId,
    incrementUnseenOrderCount,
    clearUnseenOrderCount,
  };
});