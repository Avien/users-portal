import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Order, OrderMonitoringState, OrderStreamEvent, User } from '@portal/users/utils';
import {
  createOrderMonitoringState,
  reduceOrderMonitoring,
  ORDER_BURST_WINDOW_MS,
  DEFAULT_ORDERS_WS_URL,
  buildOrdersSocketUrl,
} from '@portal/users/utils';
import { useUsersStore } from '../store/users.store';

const ORDERS_SOCKET_URL =
  import.meta.env['VITE_ORDERS_WS_URL'] ?? DEFAULT_ORDERS_WS_URL;

// Orders that arrived before a user's API fetch completed — drained into the
// cache by the facade once the query resolves (mirrors NgRx flat store behaviour)
const pendingByUser = new Map<number, Order[]>();

// Canonical-store eviction ids that arrived over WS for a user who hasn't
// hydrated yet (no cache entry for ['orders', userId] at all) — a peer to
// pendingByUser, not a replacement. Pruning the pending BUFFER of these ids
// (already done below) isn't enough on its own: the still-in-flight initial
// HTTP fetch for this user was sent before the eviction happened server-side,
// so it can resolve with a snapshot that still includes the now-evicted
// order. The facade's drain effect must filter these out of THAT HTTP result
// too, not just the buffer — otherwise a page that hasn't loaded yet can
// still end up with a stale, already-evicted order once its fetch resolves.
const pendingRemovedIdsByUser = new Map<number, Set<number>>();

export function drainPendingOrders(userId: number): Order[] {
  const orders = pendingByUser.get(userId) ?? [];
  pendingByUser.delete(userId);
  return orders;
}

export function drainPendingRemovedIds(userId: number): Set<number> {
  const ids = pendingRemovedIdsByUser.get(userId) ?? new Set<number>();
  pendingRemovedIdsByUser.delete(userId);
  return ids;
}

export function useOrdersStream(): void {
  const queryClient = useQueryClient();
  const monitoringStateRef = useRef<OrderMonitoringState>(createOrderMonitoringState());
  const streamedOrdersRef = useRef<Order[]>([]);

  useEffect(() => {
    const ws = new WebSocket(buildOrdersSocketUrl(ORDERS_SOCKET_URL));

    ws.onmessage = (event: MessageEvent) => {
      let parsed: OrderStreamEvent;
      try {
        parsed = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (parsed.type !== 'order-update') return;

      const order = parsed.payload;
      const removedOrderIds = parsed.removedOrderIds;

      queryClient.setQueryData<Order[]>(['orders', order.userId], (prev) => {
        if (prev) {
          // Remove canonical evictions first, then upsert — converges this
          // cache to the exact same retained set the canonical store has.
          const withoutEvicted = removedOrderIds?.length
            ? prev.filter((o) => !removedOrderIds.includes(o.id))
            : prev;
          // The initial REST fetch now reads the same canonical live store this
          // order came from, so it can race this WS message and already include
          // it — append only if it's genuinely not there yet.
          if (withoutEvicted.some((o) => o.id === order.id)) return withoutEvicted;
          return [...withoutEvicted, order];
        }
        // Cache not populated yet — buffer until the facade drains it after API
        // load. Also prune any ids this same message evicted out of the buffer
        // itself, so a since-evicted order can never be drained back in later —
        // and record them as pending removals too, since the in-flight HTTP
        // fetch for this user (not this buffer) may be the one that reintroduces
        // them (the WS-before-HTTP hydration race).
        let buffered = pendingByUser.get(order.userId) ?? [];
        if (removedOrderIds?.length) {
          buffered = buffered.filter((o) => !removedOrderIds.includes(o.id));
          const tombstones = pendingRemovedIdsByUser.get(order.userId) ?? new Set<number>();
          for (const id of removedOrderIds) tombstones.add(id);
          pendingRemovedIdsByUser.set(order.userId, tombstones);
        }
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

      const {
        addNotification,
        selectedUserId,
        markOrderArrived,
        incrementUnseenOrderCount,
        clearArrivedOrders,
      } = useUsersStore.getState();
      for (const payload of toastPayloads) {
        addNotification(payload);
      }

      // Live WebSocket order visual feedback (Post-production / Portfolio
      // Polish) — reuses this same onmessage handler, no second subscription
      // or connection. Reads selectedUserId fresh on every message (not
      // captured in a closure), so it always reflects whichever user is
      // selected at the moment this specific order arrives.
      if (removedOrderIds?.length) {
        clearArrivedOrders(removedOrderIds);
      }
      if (order.userId === selectedUserId) {
        markOrderArrived(order.id);
      } else {
        incrementUnseenOrderCount(order.userId);
      }
    };

    return () => {
      ws.close();
      monitoringStateRef.current = createOrderMonitoringState();
      streamedOrdersRef.current = [];
    };
  }, [queryClient]);
}
