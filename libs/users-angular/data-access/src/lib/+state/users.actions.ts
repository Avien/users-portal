import { createActionGroup, props, emptyProps } from '@ngrx/store';
import { User, Order } from '@portal/users/utils';

export const UsersActions = createActionGroup({
  source: 'Users',
  events: {
    // LOAD USERS
    'Load Users': emptyProps(),
    'Load Users Success': props<{ users: User[] }>(),
    'Load Users Failure': props<{ error: string }>(),

    // LOAD ORDERS
    'Load User Orders': props<{ userId: number }>(),
    'Load User Orders Success': props<{ userId: number; orders: Order[] }>(),
    'Load User Orders Failure': props<{ error: string }>(),

    // CRUD USERS
    'Add User': props<{ user: User }>(),
    'Add User Success': props<{ user: User }>(),
    'Add User Failure': props<{ error: string }>(),

    'Update User': props<{ user: User }>(),
    'Update User Success': props<{ user: User }>(),
    'Update User Failure': props<{ error: string }>(),

    'Delete User': props<{ userId: number }>(),
    'Delete User Success': props<{ userId: number }>(),
    'Delete User Failure': props<{ error: string }>(),

    // UI
    'Select User': props<{ userId: number }>(),

    ordersUpdatedFromStream: props<{ order: Order }>()
  }
});
