import type { User } from '@portal/users-angular/utils';
import { USERS } from '../mock/data.mock';

export function fetchUsers(): Promise<User[]> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(USERS), 1500);
  });
}
