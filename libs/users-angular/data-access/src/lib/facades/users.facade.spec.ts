import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { UsersFacade } from './users.facade';
import { UsersActions } from '../+state/users.actions';
import { UsersSelectors } from '../+state/users.selectors';
import { User, Order, UserOrderSummary } from '@fmr/users-angular/utils';
import { OrderNotificationsService } from '../services/order-notifications.service';

describe('UsersFacade', () => {
  let facade: UsersFacade;
  let store: MockStore;
  let orderNotifications: { enqueue: jest.Mock; dismiss: jest.Mock; clearAll: jest.Mock };

  beforeEach(() => {
    orderNotifications = {
      enqueue: jest.fn(),
      dismiss: jest.fn(),
      clearAll: jest.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: OrderNotificationsService, useValue: orderNotifications },
        UsersFacade,
        provideMockStore({
          selectors: [
            { selector: UsersSelectors.selectAllUsers, value: [] },
            { selector: UsersSelectors.selectAllOrders, value: [] },
            { selector: UsersSelectors.selectSelectedUserId, value: null },
            { selector: UsersSelectors.selectSelectedUserOrders, value: [] },
            { selector: UsersSelectors.selectUserOrderSummary, value: null },
            { selector: UsersSelectors.selectLoadedUserOrderIds, value: [] },
            { selector: UsersSelectors.selectLoading, value: false },
            { selector: UsersSelectors.selectLoaded, value: false },
            { selector: UsersSelectors.selectError, value: null }
          ]
        })
      ]
    });

    facade = TestBed.inject(UsersFacade);
    store = TestBed.inject(MockStore);

    jest.spyOn(store, 'dispatch');
  });

  it('should be created', () => {
    expect(facade).toBeTruthy();
  });

  describe('Signals & ViewModel ($vm)', () => {
    it('should compute $vm correctly based on updated store selectors', () => {
      const mockUsers: User[] = [{ id: 1, name: 'Avi Cohen' }];
      const mockOrders: Order[] = [{ id: 101, userId: 1, total: 500 }];
      const mockSummary: UserOrderSummary = {
        userName: 'Avi Cohen',
        totalAmount: 500
      };

      store.overrideSelector(UsersSelectors.selectAllUsers, mockUsers);
      store.overrideSelector(UsersSelectors.selectAllOrders, mockOrders);
      store.overrideSelector(UsersSelectors.selectSelectedUserId, 1);
      store.overrideSelector(UsersSelectors.selectSelectedUserOrders, mockOrders);
      store.overrideSelector(UsersSelectors.selectUserOrderSummary, mockSummary);
      store.overrideSelector(UsersSelectors.selectLoading, true);
      store.overrideSelector(UsersSelectors.selectLoaded, false);
      store.overrideSelector(UsersSelectors.selectError, null);

      store.refreshState();

      expect(facade.$vm()).toEqual({
        users: mockUsers,
        selectedUserId: 1,
        selectedUserSummary: mockSummary,
        orders: mockOrders,
        loading: true,
        loaded: false,
        error: null,
        notifications: []
      });
    });
  });

  describe('loadUsers & Caching Logic', () => {
    it('should dispatch loadUsers when $users is empty', () => {
      store.overrideSelector(UsersSelectors.selectAllUsers, []);
      store.refreshState();

      facade.loadUsers();

      expect(store.dispatch).toHaveBeenCalledWith(UsersActions.loadUsers());
    });

    it('should NOT dispatch loadUsers when $users already has data (Cache Hit)', () => {
      const mockUsers: User[] = [{ id: 1, name: 'Avi Cohen' }];

      store.overrideSelector(UsersSelectors.selectAllUsers, mockUsers);
      store.refreshState();

      facade.loadUsers();

      expect(store.dispatch).not.toHaveBeenCalledWith(UsersActions.loadUsers());
    });
  });

  describe('selectUser & Caching Logic', () => {
    it('should dispatch selectUser AND loadUserOrders when selected user was never loaded from API', () => {
      store.overrideSelector(UsersSelectors.selectLoadedUserOrderIds, []);
      store.refreshState();

      facade.selectUser(1);

      expect(store.dispatch).toHaveBeenCalledWith(UsersActions.selectUser({ userId: 1 }));
      expect(store.dispatch).toHaveBeenCalledWith(UsersActions.loadUserOrders({ userId: 1 }));
    });

    it('should dispatch ONLY selectUser when selected user orders were already loaded from API', () => {
      store.overrideSelector(UsersSelectors.selectLoadedUserOrderIds, [1]);
      store.refreshState();

      facade.selectUser(1);

      expect(store.dispatch).toHaveBeenCalledWith(UsersActions.selectUser({ userId: 1 }));
      expect(store.dispatch).not.toHaveBeenCalledWith(UsersActions.loadUserOrders({ userId: 1 }));
    });
  });

  describe('CRUD API & Load Operations', () => {
    it('should dispatch loadUsers action', () => {
      facade.loadUsers();
      expect(store.dispatch).toHaveBeenCalledWith(UsersActions.loadUsers());
    });

    it('should dispatch addUser action', () => {
      const newUser: User = { id: 2, name: 'Dana' };
      facade.addUser(newUser);
      expect(store.dispatch).toHaveBeenCalledWith(UsersActions.addUser({ user: newUser }));
    });

    it('should dispatch updateUser action', () => {
      const updatedUser: User = { id: 2, name: 'Dana Levi' };
      facade.updateUser(updatedUser);
      expect(store.dispatch).toHaveBeenCalledWith(UsersActions.updateUser({ user: updatedUser }));
    });

    it('should dispatch deleteUser action', () => {
      facade.deleteUser(2);
      expect(store.dispatch).toHaveBeenCalledWith(UsersActions.deleteUser({ userId: 2 }));
    });
  });

  describe('dismissOrderNotification', () => {
    it('should delegate dismiss to OrderNotificationsService', () => {
      facade.dismissOrderNotification('n-1');
      expect(orderNotifications.dismiss).toHaveBeenCalledTimes(1);
      expect(orderNotifications.dismiss.mock.calls[0][1]).toBe('n-1');
    });
  });
});
