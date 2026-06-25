/// <reference types="vite/client" />
import { onMounted, onScopeDispose } from 'vue';
import { useQueryClient } from '@tanstack/vue-query';
import type { Order, OrderMonitoringState, User } from '@portal/users/utils';
import {
  createOrderMonitoringState,
  reduceOrderMonitoring,
  ORDER_BURST_WINDOW_MS,
  DEFAULT_ORDERS_WS_URL,
} from '@portal/users/utils';
import { useUsersStore } from '../store/users.store';

const ORDERS_SOCKET_URL =
  import.meta.env['VITE_ORDERS_WS_URL'] ?? DEFAULT_ORDERS_WS_URL;

interface OrderStreamEvent {
  type: string;
  payload: Order;
}

// Orders that arrived before a user's API fetch completed — drained into the
// cache by the facade once the query resolves (mirrors NgRx flat store behaviour).
const pendingByUser = new Map<number, Order[]>();

export function drainPendingOrders(userId: number): Order[] {
  const orders = pendingByUser.get(userId) ?? [];
  pendingByUser.delete(userId);
  return orders;
}

// Infrastructure composable — call ONCE from App setup, not from the facade.
// The Vue equivalent of React's useOrdersStream: setup runs once, so the
// monitoring state and streamed-orders buffer are plain closure variables
// (no ref needed — they're never rendered), and cleanup runs on scope dispose.
export function useOrdersStream(): void {
  const queryClient = useQueryClient();
  const usersStore = useUsersStore();
  let monitoringState: OrderMonitoringState = createOrderMonitoringState();
  let streamedOrders: Order[] = [];
  let ws: WebSocket | undefined;

  onMounted(() => {
    ws = new WebSocket(ORDERS_SOCKET_URL);

    ws.onmessage = (event: MessageEvent) => {
      let parsed: OrderStreamEvent;
      try {
        parsed = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (parsed.type !== 'order-update') return;

      const order = parsed.payload;

      queryClient.setQueryData<Order[]>(['orders', order.userId], (prev) => {
        if (prev) return [...prev, order];
        // Cache not populated yet — buffer until the facade drains it after API load.
        const buffered = pendingByUser.get(order.userId) ?? [];
        pendingByUser.set(order.userId, [...buffered, order]);
        return prev;
      });

      streamedOrders = [...streamedOrders, order];
      const users = queryClient.getQueryData<User[]>(['users']) ?? [];
      const { next, toastPayloads } = reduceOrderMonitoring(
        monitoringState,
        streamedOrders,
        users,
        { now: Date.now(), burstWindowMs: ORDER_BURST_WINDOW_MS },
      );
      monitoringState = next;

      for (const payload of toastPayloads) {
        usersStore.addNotification(payload);
      }
    };
  });

  onScopeDispose(() => {
    ws?.close();
    monitoringState = createOrderMonitoringState();
    streamedOrders = [];
  });
}