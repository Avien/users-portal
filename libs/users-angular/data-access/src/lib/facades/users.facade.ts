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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { Actions, ofType } from '@ngrx/effects';
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
} from '@portal/users/utils';
import { UsersActions } from '../+state/users.actions';
import { UsersSelectors } from '../+state/users.selectors';
import { OrderNotificationsService } from '../services/order-notifications.service';
import { LiveOrderFeedbackService } from '../services/live-order-feedback.service';

@Injectable({ providedIn: 'root' })
export class UsersFacade implements IUsersFacadeInteractions {
  private readonly store: Store<AppState> = inject(Store<AppState>);
  private readonly router: Router = inject(Router);
  private readonly destroyRef: DestroyRef = inject(DestroyRef);
  private readonly orderNotifications: OrderNotificationsService = inject(OrderNotificationsService);
  private readonly liveOrderFeedback: LiveOrderFeedbackService = inject(LiveOrderFeedbackService);
  private readonly actions$: Actions = inject(Actions);

  private orderMonitoringState: OrderMonitoringState = createOrderMonitoringState();
  private readonly orderMonitoringEffect: EffectRef;

  private readonly $allOrders: Signal<Order[]> = this.store.selectSignal(UsersSelectors.selectAllOrders);
  private readonly $notifications: WritableSignal<Notification[]> = signal([]);

  // Live WebSocket order visual feedback (Post-production / Portfolio Polish,
  // docs/roadmap.md) — ephemeral presentation state only, never persisted to
  // the NgRx store and never added to the shared Order model/WS contract. Both
  // are populated exclusively from the `ordersUpdatedFromStream` action (see
  // setupLiveOrderFeedback below), which only ever fires for genuine WS
  // arrivals — `loadUserOrdersSuccess` (HTTP hydration) never touches either.
  private readonly recentlyArrivedOrderIdsSignal: WritableSignal<ReadonlySet<number>> = signal(new Set<number>());
  private readonly unseenOrderCountsByUserIdSignal: WritableSignal<Readonly<Record<number, number>>> = signal({});

  readonly $users: Signal<User[]> = this.store.selectSignal(UsersSelectors.selectAllUsers);
  readonly $selectedUserId: Signal<number | null> = this.store.selectSignal(UsersSelectors.selectSelectedUserId);
  readonly $selectedUserOrders: Signal<Order[]> = this.store.selectSignal(UsersSelectors.selectSelectedUserOrders);
  readonly $selectedUserOrderSummary: Signal<UserOrderSummary | null> = this.store.selectSignal(UsersSelectors.selectUserOrderSummary);
  readonly $loadedUserOrderIds: Signal<number[]> = this.store.selectSignal(UsersSelectors.selectLoadedUserOrderIds);
  readonly $loading: Signal<boolean> = this.store.selectSignal(UsersSelectors.selectLoading);
  readonly $loaded: Signal<boolean> = this.store.selectSignal(UsersSelectors.selectLoaded);
  readonly $error: Signal<string | null> = this.store.selectSignal(UsersSelectors.selectError);

  // Not part of $vm/UserOrdersVm on purpose — this is Angular-only ephemeral
  // UI state (see the field comments above), not a shared cross-framework
  // contract in @portal/users/utils.
  readonly $recentlyArrivedOrderIds: Signal<ReadonlySet<number>> = this.recentlyArrivedOrderIdsSignal;
  readonly $unseenOrderCountsByUserId: Signal<Readonly<Record<number, number>>> = this.unseenOrderCountsByUserIdSignal;

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
    this.orderMonitoringEffect = this.setupOrderMonitoringEffect();
    this.setupLiveOrderFeedback();
  }

  loadUsers(): void {
    if (!this.$users().length) {
      this.store.dispatch(UsersActions.loadUsers());
    }
  }

  // IUsersFacadeInteractions — called by UI when the user clicks a button
  selectUser(userId: number): void {
    this.router.navigate(['/users', userId]);
  }

  // Called by resolvers only — not a UI interaction, not on IUsersFacadeInteractions
  selectUserFromRoute(userId: number): void {
    this.store.dispatch(UsersActions.selectUser({ userId }));
    if (!this.$loadedUserOrderIds().includes(userId)) {
      this.store.dispatch(UsersActions.loadUserOrders({ userId }));
    }
    // Selecting a tab is what "seeing" its unseen orders means — clear its
    // badge count regardless of whether this is a fresh load or a re-select.
    this.clearUnseenOrderCount(userId);
  }

  dismissOrderNotification(id: string): void {
    this.orderNotifications.dismiss(this.$notifications, id);
  }

  addUser(user: User): void {
    this.store.dispatch(UsersActions.addUser({ user }));
  }

  updateUser(user: User): void {
    this.store.dispatch(UsersActions.updateUser({ user }));
  }

  deleteUser(userId: number): void {
    this.store.dispatch(UsersActions.deleteUser({ userId }));
  }

  // Live WebSocket order visual feedback. Subscribes to the SAME
  // `ordersUpdatedFromStream` action the reducer already consumes (see
  // OrdersService/UsersEffects) — deliberately NOT a second subscription to
  // the raw WS Observable, so this introduces no additional connection and
  // can never fire for HTTP-hydrated orders (those dispatch a different
  // action, `loadUserOrdersSuccess`, which this never listens for).
  private setupLiveOrderFeedback(): void {
    this.actions$
      .pipe(ofType(UsersActions.ordersUpdatedFromStream), takeUntilDestroyed(this.destroyRef))
      .subscribe(({ order, removedOrderIds }) => {
        // Eviction first: an id that's both being evicted AND is the new
        // arrival can't happen (the store never evicts the order it just
        // inserted), but doing this first either way keeps the highlight set
        // from ever holding a reference the canonical store no longer has.
        if (removedOrderIds.length > 0) {
          this.liveOrderFeedback.clearArrived(this.recentlyArrivedOrderIdsSignal, removedOrderIds);
        }
        if (order.userId === this.$selectedUserId()) {
          this.liveOrderFeedback.markArrived(this.recentlyArrivedOrderIdsSignal, order.id);
        } else {
          this.unseenOrderCountsByUserIdSignal.update((counts) => ({
            ...counts,
            [order.userId]: (counts[order.userId] ?? 0) + 1
          }));
        }
      });

    this.destroyRef.onDestroy(() => {
      this.liveOrderFeedback.clearAll(this.recentlyArrivedOrderIdsSignal);
      this.unseenOrderCountsByUserIdSignal.set({});
    });
  }

  private clearUnseenOrderCount(userId: number): void {
    this.unseenOrderCountsByUserIdSignal.update((counts) => {
      if (!(userId in counts)) return counts;
      return Object.fromEntries(Object.entries(counts).filter(([id]) => Number(id) !== userId));
    });
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