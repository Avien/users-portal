import { Order, User } from '@fmr/users-angular/utils';

export const MOCK_USERS: User[] = [
  { id: 1, name: 'Avi Cohen' },
  { id: 2, name: 'Dana Levi' },
  { id: 3, name: 'Noam Katz' }
];

export const MOCK_ORDERS: Order[] = [
  { id: 101, userId: 1, total: 120.5 },
  { id: 102, userId: 1, total: 79.9 },
  { id: 201, userId: 2, total: 220 },
  { id: 202, userId: 2, total: 18.75 },
  { id: 301, userId: 3, total: 510.1 },
  { id: 302, userId: 3, total: 99.9 },
  { id: 303, userId: 3, total: 45 }
];
