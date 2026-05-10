import type { Order } from '@portal/users/utils';
import { MOCK_ORDERS } from '@portal/users/utils';

export function fetchOrdersByUser(userId: number): Promise<Order[]> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(MOCK_ORDERS.filter((o) => o.userId === userId)), 800);
  });
}
