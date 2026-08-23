import { BaseEntityState } from './base-entity-state.interface';
import { Order } from './order.interface';

export interface OrdersState extends BaseEntityState<Order> {
  loadedUserIds: number[];
  // Canonical-store eviction ids (see tools/orders-store.mjs's retention) that
  // arrived over WS for a user whose orders haven't been HTTP-loaded yet
  // (userId not in loadedUserIds). removeMany() against not-yet-loaded entity
  // state is a no-op — the id doesn't exist there yet — so these are held here
  // until that user's loadUserOrdersSuccess resolves and can reconcile them
  // against the (possibly stale, evicted-order-including) HTTP snapshot.
  pendingEvictedIdsByUserId: Record<number, number[]>;
}
