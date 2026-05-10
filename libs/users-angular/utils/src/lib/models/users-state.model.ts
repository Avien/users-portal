import { BaseEntityState } from './base-entity-state.interface';
import { User } from './user.interface';

export interface UsersState extends BaseEntityState<User> {
  selectedUserId: number | null;
}
