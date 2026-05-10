import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Order, OrderMonitoringState, User } from '@portal/users/utils';
import {
  createOrderMonitoringState,
  reduceOrderMonitoring,
  ORDER_BURST_WINDOW_MS,
} from '@portal/users/utils';
import { useUsersStore } from '../store/users.store';

const ORDERS_SOCKET_URL = 'ws://localhost:3000/orders';

interface OrderStreamEvent {
  type: string;
  payload: Order;
}

// Orders that arrived before a user's API fetch completed — drained into the
// cache by the facade once the query resolves (mirrors NgRx flat store behaviour)
const pendingByUser = new Map<number, Order[]>();

export function drainPendingOrders(userId: number): Order[] {
  const orders = pendingByUser.get(userId) ?? [];
  pendingByUser.delete(userId);
  return orders;
}

export function useOrdersStream(): void {
  const queryClient = useQueryClient();
  const monitoringStateRef = useRef<OrderMonitoringState>(createOrderMonitoringState());
  const streamedOrdersRef = useRef<Order[]>([]);

  useEffect(() => {
    const ws = new WebSocket(ORDERS_SOCKET_URL);

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
        // Cache not populated yet — buffer until the facade drains it after API load
        const buffered = pendingByUser.get(order.userId) ?? [];
        pendingByUser.set(order.userId, [...buffered, order]);
        return prev;
      });

      streamedOrdersRef.current = [...streamedOrdersRef.current, order];
      const users = queryClient.getQueryData<User[]>(['users']) ?? [];
      const { next, toastPayloads } = reduceOrderMonitoring(
        monitoringStateRef.current,
        streamedOrdersRef.current,
        users,
        { now: Date.now(), burstWindowMs: ORDER_BURST_WINDOW_MS }
      );
      monitoringStateRef.current = next;

      const { addNotification } = useUsersStore.getState();
      for (const payload of toastPayloads) {
        addNotification(payload);
      }
    };

    return () => {
      ws.close();
      monitoringStateRef.current = createOrderMonitoringState();
      streamedOrdersRef.current = [];
    };
  }, [queryClient]);
}
