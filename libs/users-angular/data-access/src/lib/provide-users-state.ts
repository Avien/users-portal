import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { ordersReducer } from './+state/orders.reducer';
import { usersReducer } from './+state/users.reducer';
import { UsersEffects } from './+state/users.effects';
import { ORDERS_FEATURE_KEY, USERS_FEATURE_KEY } from '@portal/users-angular/utils';

export function provideUsersState(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideState(USERS_FEATURE_KEY, usersReducer),
    provideState(ORDERS_FEATURE_KEY, ordersReducer),
    provideEffects(UsersEffects)
  ]);
}
