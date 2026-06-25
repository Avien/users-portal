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

// Pinia setup store — the idiomatic Vue equivalent of the React Zustand store
// (UI state only: notifications; selectedUserId lives in the URL via vue-router).
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

  return { notifications, addNotification, dismissNotification };
});