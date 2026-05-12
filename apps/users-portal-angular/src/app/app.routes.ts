import { Route } from '@angular/router';
import {
  autoSelectUserGuard,
  selectUserResolver,
  UserOrdersComponent,
} from '@portal/users-angular/feature';

export const appRoutes: Route[] = [
  {
    path: 'users/:userId',
    component: UserOrdersComponent,
    resolve: { _: selectUserResolver },
  },
  {
    path: 'users',
    canActivate: [autoSelectUserGuard],
    component: UserOrdersComponent,
  },
  { path: '**', redirectTo: 'users' },
];