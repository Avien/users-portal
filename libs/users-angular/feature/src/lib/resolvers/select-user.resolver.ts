import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { UsersFacade } from '@portal/users-angular/data-access';

// Fires before UserOrdersComponent loads for /users/:userId.
// Syncs the route param into the NgRx store — the Angular equivalent of
// React's useParams() driving selectedUserId in the facade.
export const selectUserResolver: ResolveFn<void> = (route) => {
  const facade = inject(UsersFacade);
  const userId = Number(route.params['userId']);
  facade.loadUsers();
  facade.selectUserFromRoute(userId);
};