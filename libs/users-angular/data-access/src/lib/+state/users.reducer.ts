import { createEntityAdapter } from '@ngrx/entity';
import { createReducer, on } from '@ngrx/store';
import { User, UsersState } from '@portal/users-angular/utils';
import { UsersActions } from './users.actions';

export const usersAdapter = createEntityAdapter<User>();

export const initialUsersState: UsersState = usersAdapter.getInitialState({
  selectedUserId: null,
  loading: false,
  loaded: false,
  error: null
});

export const usersReducer = createReducer(
  initialUsersState,

  on(UsersActions.loadUsers, (state) => ({
    ...state,
    loading: true,
    error: null
  })),

  on(UsersActions.loadUsersSuccess, (state, { users }) => {
    const nextState = usersAdapter.upsertMany(users, {
      ...state,
      loading: false,
      loaded: true,
      error: null
    });

    return {
      ...nextState,
      selectedUserId: nextState.selectedUserId ?? users[0]?.id ?? null
    };
  }),

  on(UsersActions.loadUsersFailure, (state, { error }) => ({
    ...state,
    loading: false,
    loaded: false,
    error
  })),

  on(UsersActions.selectUser, (state, { userId }) => ({
    ...state,
    selectedUserId: userId
  })),

  on(UsersActions.addUser, (state) => ({
    ...state,
    loading: true,
    error: null
  })),

  on(UsersActions.addUserSuccess, (state, { user }) =>
    usersAdapter.upsertOne(user, {
      ...state,
      loading: false,
      loaded: true,
      error: null
    })
  ),

  on(UsersActions.addUserFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error
  })),

  on(UsersActions.updateUser, (state) => ({
    ...state,
    loading: true,
    error: null
  })),

  on(UsersActions.updateUserSuccess, (state, { user }) =>
    usersAdapter.upsertOne(user, {
      ...state,
      loading: false,
      loaded: true,
      error: null
    })
  ),

  on(UsersActions.updateUserFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error
  })),

  on(UsersActions.deleteUser, (state) => ({
    ...state,
    loading: true,
    error: null
  })),

  on(UsersActions.deleteUserSuccess, (state, { userId }) => {
    const nextState = usersAdapter.removeOne(userId, {
      ...state,
      loading: false,
      loaded: true,
      error: null
    });

    const selectedFallbackId =
      nextState.selectedUserId === userId
        ? (nextState.ids.find((id) => id !== userId) ?? null)
        : nextState.selectedUserId;

    return {
      ...nextState,
      selectedUserId: selectedFallbackId === null ? null : Number(selectedFallbackId)
    };
  }),

  on(UsersActions.deleteUserFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error
  }))
);
