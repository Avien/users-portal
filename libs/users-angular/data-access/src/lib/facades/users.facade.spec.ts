import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Subject } from 'rxjs';
import { UsersFacade } from './users.facade';
import { UsersActions } from '../+state/users.actions';
import { UsersSelectors } from '../+state/users.selectors';
import { User, Order, UserOrderSummary } from '@portal/users/utils';
import { OrderNotificationsService } from '../services/order-notifications.service';

describe('UsersFacade', () => {
  let facade: UsersFacade;
  let store: MockStore;
  let mockRouter: { navigate: jest.Mock };
  let orderNotifications: { enqueue: jest.Mock; dismiss: jest.Mock; clearAll: jest.Mock };
  let actions$: Subject<unknown>;

  beforeEach(() => {
    mockRouter = { navigate: jest.fn() };
    orderNotifications = { enqueue: jest.fn(), dismiss: jest.fn(), clearAll: jest.fn() };
    actions$ = new Subject();

    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: mockRouter },
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
        }),
        provideMockActions(() => actions$)
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
      const mockSummary: UserOrderSummary = { userName: 'Avi Cohen', totalAmount: 500 };

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

  describe('loadUsers', () => {
    it('should dispatch loadUsers when $users is empty', () => {
      store.overrideSelector(UsersSelectors.selectAllUsers, []);
      store.refreshState();
      facade.loadUsers();
      expect(store.dispatch).toHaveBeenCalledWith(UsersActions.loadUsers());
    });

    it('should NOT dispatch loadUsers when $users already has data', () => {
      store.overrideSelector(UsersSelectors.selectAllUsers, [{ id: 1, name: 'Avi' }]);
      store.refreshState();
      facade.loadUsers();
      expect(store.dispatch).not.toHaveBeenCalledWith(UsersActions.loadUsers());
    });
  });

  describe('selectUser — UI action, navigates only', () => {
    it('should navigate to /users/:id without dispatching', () => {
      facade.selectUser(1);
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/users', 1]);
      expect(store.dispatch).not.toHaveBeenCalledWith(UsersActions.selectUser({ userId: 1 }));
    });
  });

  describe('selectUserFromRoute — resolver infrastructure, dispatches only', () => {
    it('should dispatch selectUser AND loadUserOrders for an unloaded user', () => {
      store.overrideSelector(UsersSelectors.selectLoadedUserOrderIds, []);
      store.refreshState();
      facade.selectUserFromRoute(1);
      expect(store.dispatch).toHaveBeenCalledWith(UsersActions.selectUser({ userId: 1 }));
      expect(store.dispatch).toHaveBeenCalledWith(UsersActions.loadUserOrders({ userId: 1 }));
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('should dispatch ONLY selectUser for an already-loaded user', () => {
      store.overrideSelector(UsersSelectors.selectLoadedUserOrderIds, [1]);
      store.refreshState();
      facade.selectUserFromRoute(1);
      expect(store.dispatch).toHaveBeenCalledWith(UsersActions.selectUser({ userId: 1 }));
      expect(store.dispatch).not.toHaveBeenCalledWith(UsersActions.loadUserOrders({ userId: 1 }));
    });
  });

  describe('CRUD operations', () => {
    it('should dispatch addUser', () => {
      const user: User = { id: 2, name: 'Dana' };
      facade.addUser(user);
      expect(store.dispatch).toHaveBeenCalledWith(UsersActions.addUser({ user }));
    });

    it('should dispatch updateUser', () => {
      const user: User = { id: 2, name: 'Dana Levi' };
      facade.updateUser(user);
      expect(store.dispatch).toHaveBeenCalledWith(UsersActions.updateUser({ user }));
    });

    it('should dispatch deleteUser', () => {
      facade.deleteUser(2);
      expect(store.dispatch).toHaveBeenCalledWith(UsersActions.deleteUser({ userId: 2 }));
    });
  });

  describe('dismissOrderNotification', () => {
    it('should delegate to OrderNotificationsService', () => {
      facade.dismissOrderNotification('n-1');
      expect(orderNotifications.dismiss).toHaveBeenCalledTimes(1);
      expect(orderNotifications.dismiss.mock.calls[0][1]).toBe('n-1');
    });
  });

  // Live WebSocket order visual feedback (Post-production / Portfolio Polish).
  // The facade reacts to the SAME `ordersUpdatedFromStream` action the reducer
  // already consumes (fed here via provideMockActions) — it never subscribes
  // to a WebSocket/OrdersService itself, so there is structurally no way for
  // this feature to open an additional WS connection: OrdersService isn't
  // even provided in this test module, and the facade still works.
  describe('live order feedback', () => {
    const order101: Order = { id: 101, userId: 1, total: 42, status: 'pending' };
    const order201: Order = { id: 201, userId: 2, total: 99, status: 'pending' };

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('marks a WS order for the currently selected user as recently arrived', () => {
      store.overrideSelector(UsersSelectors.selectSelectedUserId, 1);
      store.refreshState();

      actions$.next(UsersActions.ordersUpdatedFromStream({ order: order101, removedOrderIds: [] }));

      expect(facade.$recentlyArrivedOrderIds().has(101)).toBe(true);
    });

    it('clears the recently-arrived state again after the highlight duration (~2.5s)', () => {
      store.overrideSelector(UsersSelectors.selectSelectedUserId, 1);
      store.refreshState();

      actions$.next(UsersActions.ordersUpdatedFromStream({ order: order101, removedOrderIds: [] }));
      expect(facade.$recentlyArrivedOrderIds().has(101)).toBe(true);

      jest.advanceTimersByTime(2500);

      expect(facade.$recentlyArrivedOrderIds().has(101)).toBe(false);
    });

    it('does NOT mark anything recently-arrived for HTTP hydration (loadUserOrdersSuccess), only genuine WS arrivals', () => {
      store.overrideSelector(UsersSelectors.selectSelectedUserId, 1);
      store.refreshState();

      actions$.next(UsersActions.loadUserOrdersSuccess({ userId: 1, orders: [order101] }));

      expect(facade.$recentlyArrivedOrderIds().has(101)).toBe(false);
    });

    it('increments the unseen-order count for a WS order arriving for a user who is NOT selected', () => {
      store.overrideSelector(UsersSelectors.selectSelectedUserId, 1);
      store.refreshState();

      actions$.next(UsersActions.ordersUpdatedFromStream({ order: order201, removedOrderIds: [] }));

      expect(facade.$unseenOrderCountsByUserId()).toEqual({ 2: 1 });
      // The selected user's own arrival never gets a badge count.
      expect(facade.$recentlyArrivedOrderIds().has(order201.id)).toBe(false);
    });

    it('increments cleanly across multiple unseen orders for the same unselected user (+1, +2, ...)', () => {
      store.overrideSelector(UsersSelectors.selectSelectedUserId, 1);
      store.refreshState();

      actions$.next(UsersActions.ordersUpdatedFromStream({ order: order201, removedOrderIds: [] }));
      actions$.next(
        UsersActions.ordersUpdatedFromStream({ order: { ...order201, id: 202 }, removedOrderIds: [] })
      );
      actions$.next(
        UsersActions.ordersUpdatedFromStream({ order: { ...order201, id: 203 }, removedOrderIds: [] })
      );

      expect(facade.$unseenOrderCountsByUserId()).toEqual({ 2: 3 });
    });

    it('clears a user\'s unseen-order badge once their tab is selected', () => {
      store.overrideSelector(UsersSelectors.selectSelectedUserId, 1);
      store.overrideSelector(UsersSelectors.selectLoadedUserOrderIds, [1, 2]);
      store.refreshState();

      actions$.next(UsersActions.ordersUpdatedFromStream({ order: order201, removedOrderIds: [] }));
      expect(facade.$unseenOrderCountsByUserId()).toEqual({ 2: 1 });

      facade.selectUserFromRoute(2);

      expect(facade.$unseenOrderCountsByUserId()).toEqual({});
    });

    it('immediately clears an evicted order id from the recently-arrived set (retention compatibility)', () => {
      store.overrideSelector(UsersSelectors.selectSelectedUserId, 1);
      store.refreshState();

      actions$.next(UsersActions.ordersUpdatedFromStream({ order: order101, removedOrderIds: [] }));
      expect(facade.$recentlyArrivedOrderIds().has(101)).toBe(true);

      // A later insert for the same user evicts order 101 under retention.
      const newOrder: Order = { id: 199, userId: 1, total: 5, status: 'pending' };
      actions$.next(UsersActions.ordersUpdatedFromStream({ order: newOrder, removedOrderIds: [101] }));

      expect(facade.$recentlyArrivedOrderIds().has(101)).toBe(false);
      expect(facade.$recentlyArrivedOrderIds().has(199)).toBe(true);

      // The now-cancelled timer for 101 must not throw or resurrect anything.
      expect(() => jest.advanceTimersByTime(5000)).not.toThrow();
    });
  });
});