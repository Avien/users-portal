import { BaseEntityState } from './base-entity-state.interface';
import { Order } from './order.interface';

export interface OrdersState extends BaseEntityState<Order> {
  loadedUserIds: number[];
}
