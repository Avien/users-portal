import { create } from 'zustand';
import type { Notification, NotificationSeverity } from '@portal/users/utils';

const AUTO_DISMISS_MS: Record<NotificationSeverity, number> = {
  warning: 10_000,
  critical: 20_000,
};

// Lives outside state — same pattern as Angular's OrderNotificationsService.dismissTimers
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Live WebSocket order visual feedback (Post-production / Portfolio Polish,
// see docs/roadmap.md) — matches the "2-3 seconds" spec: long enough to
// notice, short enough to read as "just happened".
const HIGHLIGHT_DURATION_MS = 2500;
// Same pattern as dismissTimers above — timer handles are not store state.
const highlightTimers = new Map<number, ReturnType<typeof setTimeout>>();

interface UsersStore {
  notifications: Notification[];
  addNotification: (payload: Omit<Notification, 'id' | 'timestamp'>) => void;
  dismissNotification: (id: string) => void;

  // Mirrors the route-derived selectedUserId (owned by useUsersFacade via
  // useParams) so useOrdersStream — mounted once at the App root, above the
  // <Routes> tree, with no access to route params itself — can still tell
  // whether an arriving order is for the user currently being looked at.
  // Ephemeral UI wiring only; the URL remains the actual source of truth.
  selectedUserId: number | null;
  setSelectedUserId: (userId: number | null) => void;

  // Ephemeral presentation state only — never added to the shared Order
  // model or the WS wire contract in @portal/users/utils. Populated
  // exclusively from useOrdersStream's ws.onmessage (genuine WS arrivals);
  // HTTP hydration (fetchOrdersByUser) never touches either of these.
  recentlyArrivedOrderIds: ReadonlySet<number>;
  markOrderArrived: (orderId: number) => void;
  clearArrivedOrders: (orderIds: readonly number[]) => void;

  unseenOrderCountsByUserId: Readonly<Record<number, number>>;
  incrementUnseenOrderCount: (userId: number) => void;
  clearUnseenOrderCount: (userId: number) => void;
}

export const useUsersStore = create<UsersStore>((set, get) => ({
  notifications: [],
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

  selectedUserId: null,
  setSelectedUserId: (userId) => set({ selectedUserId: userId }),

  recentlyArrivedOrderIds: new Set(),
  markOrderArrived: (orderId) => {
    const existingTimer = highlightTimers.get(orderId);
    if (existingTimer != null) clearTimeout(existingTimer);
    set((state) => ({ recentlyArrivedOrderIds: new Set(state.recentlyArrivedOrderIds).add(orderId) }));
    const timerId = setTimeout(() => {
      highlightTimers.delete(orderId);
      set((state) => {
        if (!state.recentlyArrivedOrderIds.has(orderId)) return state;
        const next = new Set(state.recentlyArrivedOrderIds);
        next.delete(orderId);
        return { recentlyArrivedOrderIds: next };
      });
    }, HIGHLIGHT_DURATION_MS);
    highlightTimers.set(orderId, timerId);
  },
  // Called on canonical-store eviction (WS removedOrderIds) so a row
  // highlight can never outlive an order that's already gone from the
  // retained set — see the same rationale on Angular's LiveOrderFeedbackService.
  clearArrivedOrders: (orderIds) => {
    if (orderIds.length === 0) return;
    for (const id of orderIds) {
      const timer = highlightTimers.get(id);
      if (timer != null) {
        clearTimeout(timer);
        highlightTimers.delete(id);
      }
    }
    set((state) => {
      let changed = false;
      const next = new Set(state.recentlyArrivedOrderIds);
      for (const id of orderIds) {
        if (next.delete(id)) changed = true;
      }
      return changed ? { recentlyArrivedOrderIds: next } : state;
    });
  },

  unseenOrderCountsByUserId: {},
  incrementUnseenOrderCount: (userId) =>
    set((state) => ({
      unseenOrderCountsByUserId: {
        ...state.unseenOrderCountsByUserId,
        [userId]: (state.unseenOrderCountsByUserId[userId] ?? 0) + 1,
      },
    })),
  clearUnseenOrderCount: (userId) =>
    set((state) => {
      if (!(userId in state.unseenOrderCountsByUserId)) return state;
      const next = { ...state.unseenOrderCountsByUserId };
      delete next[userId];
      return { unseenOrderCountsByUserId: next };
    }),
}));
