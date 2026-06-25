import type { RouteRecordRaw } from 'vue-router';
import { UserOrders } from '@portal/users-vue/feature';

// selectedUserId is URL-driven; both routes render the same smart container.
export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/users' },
  { path: '/users', component: UserOrders },
  { path: '/users/:userId', component: UserOrders },
  { path: '/:pathMatch(.*)*', redirect: '/users' },
];