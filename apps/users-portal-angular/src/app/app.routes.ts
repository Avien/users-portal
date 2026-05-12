import { Route } from '@angular/router';
import { autoSelectUserGuard, selectUserResolver } from '@portal/users-angular/feature';

export const appRoutes: Route[] = [
  {
    path: 'users/:userId',
    loadComponent: () =>
      import('@portal/users-angular/feature').then((m) => m.UserOrdersComponent),
    resolve: { _: selectUserResolver },
  },
  {
    path: 'users',
    canActivate: [autoSelectUserGuard],
    // loadComponent is never reached — guard always redirects to /users/:id
    loadComponent: () =>
      import('@portal/users-angular/feature').then((m) => m.UserOrdersComponent),
  },
  { path: '**', redirectTo: 'users' },
];