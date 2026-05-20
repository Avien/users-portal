import { useEffect } from 'react';
import { useQueryClient, QueryClient } from '@tanstack/react-query';
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

/** DOM event name Angular dispatches when running as the WS owner in the MFE. */
export const MFE_ORDER_EVENT = 'mfe:order-update';

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

// Module-level singleton — one socket regardless of StrictMode double-mount.
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let refCount = 0;
let monitoringState: OrderMonitoringState = createOrderMonitoringState();
let streamedOrders: Order[] = [];

function processOrder(order: Order, queryClient: QueryClient): void {
  queryClient.setQueryData<Order[]>(['orders', order.userId], (prev) => {
    if (prev) return prev.some((o) => o.id === order.id) ? prev : [...prev, order];
    // Cache not populated yet — buffer until the facade drains it after API load
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
    { now: Date.now(), burstWindowMs: ORDER_BURST_WINDOW_MS }
  );
  monitoringState = next;

  const { addNotification } = useUsersStore.getState();
  for (const payload of toastPayloads) {
    addNotification(payload);
  }
}

function connect(queryClient: QueryClient): void {
  ws = new WebSocket(ORDERS_SOCKET_URL);

  ws.onmessage = (event: MessageEvent) => {
    let parsed: OrderStreamEvent;
    try {
      parsed = JSON.parse(event.data as string);
    } catch {
      return;
    }
    if (parsed.type !== 'order-update') return;
    processOrder(parsed.payload, queryClient);
  };

  ws.onclose = () => {
    if (refCount > 0) {
      monitoringState = createOrderMonitoringState();
      streamedOrders = [];
      reconnectTimer = setTimeout(() => connect(queryClient), 3000);
    }
  };

  ws.onerror = () => ws?.close();
}

function disconnect(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    // Null handlers before close so the async onclose event does not schedule
    // a reconnect after an intentional teardown (e.g. StrictMode cleanup).
    ws.onclose = null;
    ws.onerror = null;
    ws.close();
    ws = null;
  }
  monitoringState = createOrderMonitoringState();
  streamedOrders = [];
}

export function useOrdersStream(enabled = true): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (enabled) {
      refCount++;
      if (refCount === 1) connect(queryClient);
      return () => {
        refCount--;
        if (refCount === 0) disconnect();
      };
    }

    // MFE mode: Angular owns the WS; listen for its DOM bridge events.
    const handler = (e: Event) => {
      processOrder((e as CustomEvent<Order>).detail, queryClient);
    };
    window.addEventListener(MFE_ORDER_EVENT, handler);
    return () => window.removeEventListener(MFE_ORDER_EVENT, handler);
  }, [queryClient, enabled]);
}