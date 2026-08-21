import type { RouteRecordRaw } from 'vue-router';
import UsersPage from './pages/UsersPage.vue';

// selectedUserId is URL-driven; both routes render the same page.
export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/users' },
  { path: '/users', component: UsersPage },
  { path: '/users/:userId', component: UsersPage },
  { path: '/:pathMatch(.*)*', redirect: '/users' },
];