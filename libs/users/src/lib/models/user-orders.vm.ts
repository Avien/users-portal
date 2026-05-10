import { Notification } from './notification.model';
import { Order } from './order.interface';
import { User } from './user.interface';
import { UserOrderSummary } from './user-order.summary';

/**
 * ViewModel consumed by the feature component.
 * Combines users data, selected user state and loading indicators.
 */
export interface UserOrdersVm {
  users: User[];
  selectedUserId: number | null;
  selectedUserSummary: UserOrderSummary | null;
  orders: Order[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  notifications: Notification[];
}
