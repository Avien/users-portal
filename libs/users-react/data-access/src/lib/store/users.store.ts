import { create } from 'zustand';
import type { Notification, NotificationSeverity } from '@portal/users/utils';

const AUTO_DISMISS_MS: Record<NotificationSeverity, number> = {
  warning: 10_000,
  critical: 20_000,
};

// Lives outside state — same pattern as Angular's OrderNotificationsService.dismissTimers
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

interface UsersStore {
  selectedUserId: number | null;
  notifications: Notification[];
  selectUser: (id: number) => void;
  addNotification: (payload: Omit<Notification, 'id' | 'timestamp'>) => void;
  dismissNotification: (id: string) => void;
}

export const useUsersStore = create<UsersStore>((set, get) => ({
  selectedUserId: null,
  notifications: [],
  selectUser: (id) => set({ selectedUserId: id }),
  addNotification: (payload) => {
    const id = crypto.randomUUID();
    const notification: Notification = { ...payload, id, timestamp: Date.now() };
    set((state) => ({ notifications: [...state.notifications, notification] }));
    const timerId = setTimeout(() => get().dismissNotification(id), AUTO_DISMISS_MS[payload.severity]);
    dismissTimers.set(id, timerId);
  },
  dismissNotification: (id) => {
    const timerId = dismissTimers.get(id);
    if (timerId != null) clearTimeout(timerId);
    dismissTimers.delete(id);
    set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) }));
  },
}));
