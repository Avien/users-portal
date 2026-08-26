import { inject, Injectable, InjectionToken } from '@angular/core';
import { filter, Observable, map } from 'rxjs';
import { webSocket } from 'rxjs/webSocket';
import {
  Order,
  OrderStreamEvent,
  DEFAULT_ORDERS_WS_URL,
  DEFAULT_ORDERS_API_URL,
  buildOrdersSocketUrl,
} from '@portal/users/utils';

export interface OrderStreamUpdate {
  order: Order;
  removedOrderIds: number[];
}

/** Override in tests or `app.config` when the mock server URL differs. */
export const ORDERS_SOCKET_URL = new InjectionToken<string>('ORDERS_SOCKET_URL', {
  factory: () => DEFAULT_ORDERS_WS_URL
});

/**
 * Canonical Orders REST endpoint — the same live store ORDERS_SOCKET_URL streams
 * deltas from. Override in tests or `app.config` when the backend differs.
 */
export const ORDERS_API_URL = new InjectionToken<string>('ORDERS_API_URL', {
  factory: () => DEFAULT_ORDERS_API_URL
});

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly url = inject(ORDERS_SOCKET_URL);
  private stream$ = webSocket<OrderStreamEvent>(buildOrdersSocketUrl(this.url));

  public ordersUpdates$: Observable<OrderStreamUpdate> = this.stream$.pipe(
    filter((event: OrderStreamEvent) => event.type === 'order-update'),
    map((event: OrderStreamEvent) => ({ order: event.payload, removedOrderIds: event.removedOrderIds ?? [] }))
  );
}
