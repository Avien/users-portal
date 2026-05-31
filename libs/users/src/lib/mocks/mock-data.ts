import type { User } from '../models/user.interface';
import type { Order } from '../models/order.interface';

export const MOCK_USERS: User[] = [
  { id: 1, name: 'Avi Cohen' },
  { id: 2, name: 'Dana Levi' },
  { id: 3, name: 'Noam Katz' },
];

export const MOCK_ORDERS: Order[] = [
  { id: 101, userId: 1, total: 120.5,  status: 'completed'  },
  { id: 102, userId: 1, total: 79.9,   status: 'pending'    },
  { id: 201, userId: 2, total: 220,    status: 'processing' },
  { id: 202, userId: 2, total: 18.75,  status: 'completed'  },
  { id: 301, userId: 3, total: 510.1,  status: 'completed'  },
  { id: 302, userId: 3, total: 99.9,   status: 'cancelled'  },
  { id: 303, userId: 3, total: 45,     status: 'pending'    },
];
