import { Route } from '@angular/router';
import {
  autoSelectUserGuard,
  selectUserResolver,
  UserOrdersComponent,
} from '@portal/users-angular/feature';
import { ReactWrapperComponent } from './react-wrapper/react-wrapper.component';

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
  {
    path: 'hybrid',
    component: ReactWrapperComponent,
  },
  { path: '**', redirectTo: 'users' },
];