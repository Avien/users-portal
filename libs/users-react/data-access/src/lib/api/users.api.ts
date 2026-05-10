import type { User } from '@portal/users/utils';
import { MOCK_USERS } from '@portal/users/utils';

export function fetchUsers(): Promise<User[]> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(MOCK_USERS), 1500);
  });
}
