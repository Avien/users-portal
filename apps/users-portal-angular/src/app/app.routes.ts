import { Route } from '@angular/router';
import {
  autoSelectUserGuard,
  selectUserResolver,
} from '@portal/users-angular/feature';
import { ReactWrapperComponent } from './react-wrapper/react-wrapper.component';
import { UsersPageComponent } from './users-page/users-page.component';

export const appRoutes: Route[] = [
  {
    path: 'users/:userId',
    component: UsersPageComponent,
    resolve: { _: selectUserResolver },
  },
  {
    path: 'users',
    canActivate: [autoSelectUserGuard],
    component: UsersPageComponent,
  },
  {
    path: 'hybrid',
    component: ReactWrapperComponent,
  },
  { path: '**', redirectTo: 'users' },
];