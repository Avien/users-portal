export type OrderStatus = 'pending' | 'processing' | 'completed' | 'cancelled';

export interface Order {
  id: number;
  userId: number;
  total: number;
  status: OrderStatus;
}
