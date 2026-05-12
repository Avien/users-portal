import { inject, Injector } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, firstValueFrom } from 'rxjs';
import { UsersFacade } from '@portal/users-angular/data-access';

// Guard for the /users route (no :userId).
// Waits for users to load then redirects to /users/:firstUserId.
// Returning a UrlTree from a guard is Angular's typed redirect — no router.navigate needed.
export const autoSelectUserGuard: CanActivateFn = async () => {
  const facade = inject(UsersFacade);
  const router = inject(Router);
  const injector = inject(Injector);

  facade.loadUsers();

  const users = await firstValueFrom(
    toObservable(facade.$users, { injector }).pipe(filter((u) => u.length > 0))
  );

  return router.createUrlTree(['/users', users[0].id]);
};