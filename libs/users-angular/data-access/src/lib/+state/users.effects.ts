import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, EMPTY, map, of, switchMap } from 'rxjs';
import { UserService } from '../services/user.service';
import { UsersActions } from './users.actions';
import { OrdersService } from '../services/orders.service';

@Injectable()
export class UsersEffects {
  private actions$ = inject(Actions);
  private userService = inject(UserService);
  private ordersService = inject(OrdersService);

  loadUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(UsersActions.loadUsers),
      switchMap(() =>
        this.userService.getUsers().pipe(
          map((users) => UsersActions.loadUsersSuccess({ users })),
          catchError(() => of(UsersActions.loadUsersFailure({ error: 'Failed to load users' })))
        )
      )
    )
  );

  loadUserOrders$ = createEffect(() =>
    this.actions$.pipe(
      ofType(UsersActions.loadUserOrders),
      switchMap(({ userId }) =>
        this.userService.getOrdersByUserId(userId).pipe(
          map((orders) => UsersActions.loadUserOrdersSuccess({ userId, orders })),
          catchError(() =>
            of(UsersActions.loadUserOrdersFailure({ error: 'Failed to load user orders' }))
          )
        )
      )
    )
  );

  addUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(UsersActions.addUser),
      switchMap(({ user }) =>
        this.userService.addUser(user).pipe(
          map((saved) => UsersActions.addUserSuccess({ user: saved })),
          catchError(() => of(UsersActions.addUserFailure({ error: 'Failed to add user' })))
        )
      )
    )
  );

  updateUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(UsersActions.updateUser),
      switchMap(({ user }) =>
        this.userService.updateUser(user).pipe(
          map((updated) => UsersActions.updateUserSuccess({ user: updated })),
          catchError(() => of(UsersActions.updateUserFailure({ error: 'Failed to update user' })))
        )
      )
    )
  );

  deleteUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(UsersActions.deleteUser),
      switchMap(({ userId }) =>
        this.userService.deleteUser(userId).pipe(
          map(() => UsersActions.deleteUserSuccess({ userId })),
          catchError(() => of(UsersActions.deleteUserFailure({ error: 'Failed to delete user' })))
        )
      )
    )
  );

  ordersUpdatedFromStream$ = createEffect(() => {
    return this.ordersService.ordersUpdates$.pipe(
      map((order) => UsersActions.ordersUpdatedFromStream({ order })),
      catchError(() => EMPTY)
    );
  });
}
