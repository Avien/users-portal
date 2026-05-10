import { UsersState } from './users-state.model';
import { OrdersState } from './orders-state.interface';

export interface AppState {
  users: UsersState;
  orders: OrdersState;
}
