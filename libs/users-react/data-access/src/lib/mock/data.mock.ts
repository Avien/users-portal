import type { User, Order } from '@fmr/users-angular/utils';

export const USERS: User[] = [
  { id: 1, name: 'Alice Johnson' },
  { id: 2, name: 'Bob Smith' },
  { id: 3, name: 'Carol Williams' },
];

export const ORDERS: Order[] = [
  { id: 1, userId: 1, total: 1200 },
  { id: 2, userId: 1, total: 25 },
  { id: 3, userId: 2, total: 75 },
  { id: 4, userId: 2, total: 350 },
  { id: 5, userId: 3, total: 150 },
];
