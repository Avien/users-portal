/// <reference types="vite/client" />
import type { Order } from '@portal/users/utils';
import { DEFAULT_ORDERS_API_URL, getOrdersByUserId } from '@portal/users/utils';

// Reads the same canonical current-orders source the Business Agent reads —
// not a static snapshot frozen at process start — so a browser refresh after
// new WS orders arrived shows the same data the agent would see, not stale
// MOCK_ORDERS. WS deltas are merged on top of this by useOrdersStream.
const ORDERS_API_URL = import.meta.env['VITE_ORDERS_API_URL']?.trim() || DEFAULT_ORDERS_API_URL;

export async function fetchOrdersByUser(userId: number): Promise<Order[]> {
  const res = await fetch(ORDERS_API_URL);
  if (!res.ok) throw new Error(`Failed to fetch orders (${res.status})`);
  const orders: Order[] = await res.json();
  return getOrdersByUserId(orders, userId);
}