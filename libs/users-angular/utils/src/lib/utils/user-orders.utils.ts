import { Order } from '../models/order.interface';
import { UserOrderSummary } from '../models/user-order.summary';
import { User } from '../models/user.interface';

export function getOrdersByUserId(orders: Order[], userId: number | null): Order[] {
  if (userId == null) {
    return [];
  }

  return orders
    .filter((order) => order.userId === userId)
    .sort((a, b) => a.id - b.id);
}

export function normalizeOrderUserIdFromId(order: Order): Order {
  // Assignment convention used by MOCK_ORDERS + the WS simulator:
  // 1xx -> user 1, 2xx -> user 2, 3xx -> user 3
  const userId = Math.floor(order.id / 100);

  if (userId === order.userId) {
    return order;
  }

  return { ...order, userId };
}

export function getTotalOrdersAmount(orders: Order[]): number {
  return orders.reduce((sum, order) => sum + order.total, 0);
}

export function buildUserTotalOrdersVm(
  user: User | null,
  orders: Order[]
): UserOrderSummary | null {
  if (!user) {
    return null;
  }

  return {
    userName: user.name,
    totalAmount: getTotalOrdersAmount(orders)
  };
}
