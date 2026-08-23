import { Order } from './order.interface';

/**
 * WS message contract for the Orders live stream (tools/mock-orders-ws-server.mjs).
 * Shared across the Angular/React/Vue data-access layers so the wire contract
 * can't independently drift between the three implementations.
 */
export interface OrderStreamEvent {
  type: 'order-update';
  payload: Order;
  // Present (non-empty) only when this same canonical-store insert evicted
  // retention-expired orders for this order's user (see tools/orders-store.mjs's
  // MAX_ORDERS_PER_USER cap) — omitted entirely, not an empty array, when no
  // eviction occurred. Already-connected clients MUST remove these before/while
  // upserting `payload`, or local state grows past the cap forever even though
  // every fresh GET /api/orders stays correctly bounded.
  removedOrderIds?: number[];
}
