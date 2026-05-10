import {
  computed,
  DestroyRef,
  EffectRef,
  effect,
  inject,
  Injectable,
  Signal,
  signal,
  WritableSignal
} from '@angular/core';
import { Store } from '@ngrx/store';
import {
  AppState,
  IUsersFacadeInteractions,
  Notification,
  UserOrdersVm,
  User,
  Order,
  UserOrderSummary,
  createOrderMonitoringState,
  OrderMonitoringState,
  reduceOrderMonitoring,
  ORDER_BURST_WINDOW_MS
} from '@portal/users-angular/utils';
import { UsersActions } from '../+state/users.actions';
import { UsersSelectors } from '../+state/users.selectors';
import { OrderNotificationsService } from '../services/order-notifications.service';

/**
 * UsersFacade
 *
 * Encapsulates all interaction with the NgRx store and side effects.
 * UI reads only `$vm` (includes `notifications`); NgRx stays behind this facade.
 */
@Injectable({ providedIn: 'root' })
export class UsersFacade implements IUsersFacadeInteractions {
  private readonly store: Store<AppState> = inject(Store<AppState>);
  private readonly destroyRef: DestroyRef = inject(DestroyRef);
  private readonly orderNotifications: OrderNotificationsService = inject(OrderNotificationsService);

  private orderMonitoringState: OrderMonitoringState = createOrderMonitoringState();
  private readonly orderMonitoringEffect: EffectRef;

  private readonly $allOrders: Signal<Order[]> = this.store.selectSignal(UsersSelectors.selectAllOrders);
  private readonly $notifications: WritableSignal<Notification[]> = signal([]);

  readonly $users: Signal<User[]> = this.store.selectSignal(UsersSelectors.selectAllUsers);
  readonly $selectedUserId: Signal<number | null> = this.store.selectSignal(
    UsersSelectors.selectSelectedUserId
  );
  readonly $selectedUserOrders: Signal<Order[]> = this.store.selectSignal(
    UsersSelectors.selectSelectedUserOrders
  );
  readonly $selectedUserOrderSummary: Signal<UserOrderSummary | null> = this.store.selectSignal(
    UsersSelectors.selectUserOrderSummary
  );
  readonly $loadedUserOrderIds: Signal<number[]> = this.store.selectSignal(
    UsersSelectors.selectLoadedUserOrderIds
  );
  readonly $loading: Signal<boolean> = this.store.selectSignal(UsersSelectors.selectLoading);
  readonly $loaded: Signal<boolean> = this.store.selectSignal(UsersSelectors.selectLoaded);
  readonly $error: Signal<string | null> = this.store.selectSignal(UsersSelectors.selectError);


  readonly $vm: Signal<UserOrdersVm> = computed<UserOrdersVm>(() => ({
    users: this.$users(),
    selectedUserId: this.$selectedUserId(),
    selectedUserSummary: this.$selectedUserOrderSummary(),
    orders: this.$selectedUserOrders(),
    loading: this.$loading(),
    loaded: this.$loaded(),
    error: this.$error(),
    notifications: this.$notifications()
  }));

  constructor() {
    // `readonly` fields may only be assigned in the constructor body, not inside other methods.
    this.orderMonitoringEffect = this.setupOrderMonitoringEffect();
  }

  /**
   * Loads users if they are not already present in the store.
   * Prevents redundant API requests by using cached state when available.
   */
  loadUsers() {
    const users = this.$users();

    if (!users || users.length === 0) {
      this.store.dispatch(UsersActions.loadUsers());
    }
  }


  /**
   * Select a user and load their orders if they are not already cached
   * @param userId
   */
  selectUser(userId: number) {
    this.store.dispatch(UsersActions.selectUser({ userId }));

    // Cache hit is based on successful API load for this specific user,
    // not on whether any streamed order happens to be present.
    const hasLoadedOrdersForUser = this.$loadedUserOrderIds().includes(userId);
    if (!hasLoadedOrdersForUser) {
      this.store.dispatch(UsersActions.loadUserOrders({ userId }));
    }
  }

  dismissOrderNotification(id: string): void {
    this.orderNotifications.dismiss(this.$notifications, id);
  }

  addUser(user: User) {
    this.store.dispatch(UsersActions.addUser({ user }));
  }

  updateUser(user: User) {
    this.store.dispatch(UsersActions.updateUser({ user }));
  }

  deleteUser(userId: number) {
    this.store.dispatch(UsersActions.deleteUser({ userId }));
  }

  private setupOrderMonitoringEffect(): EffectRef {
    const effectRef = effect(() => {
      const allOrders = this.$allOrders();
      const users = this.$users();
      const { next, toastPayloads } = reduceOrderMonitoring(
        this.orderMonitoringState,
        allOrders,
        users,
        { now: Date.now(), burstWindowMs: ORDER_BURST_WINDOW_MS }
      );
      this.orderMonitoringState = next;
      for (const payload of toastPayloads) {
        this.orderNotifications.enqueue(this.$notifications, payload);
      }
    });

    this.destroyRef.onDestroy(() => {
      effectRef.destroy();
      this.orderMonitoringState = createOrderMonitoringState();
      this.orderNotifications.clearAll(this.$notifications);
    });

    return effectRef;
  }
}
