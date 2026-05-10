import type { Order } from '@portal/users-angular/utils';
import { ORDERS } from '../mock/data.mock';

export function fetchOrdersByUser(userId: number): Promise<Order[]> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(ORDERS.filter((o) => o.userId === userId)), 800);
  });
}
