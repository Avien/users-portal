import { inject, Injectable, InjectionToken } from '@angular/core';
import { filter, Observable, map } from 'rxjs';
import { webSocket } from 'rxjs/webSocket';
import { Order } from '@portal/users/utils';

interface OrderStreamEvent {
  type: 'order-update';
  payload: Order;
}

/** Override in tests or `app.config` when the mock server URL differs. */
export const ORDERS_SOCKET_URL = new InjectionToken<string>('ORDERS_SOCKET_URL', {
  factory: () => 'ws://localhost:3000/orders'
});

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly url = inject(ORDERS_SOCKET_URL);
  private stream$ = webSocket<OrderStreamEvent>(this.url);

  public ordersUpdates$: Observable<Order> = this.stream$.pipe(
    filter((event: OrderStreamEvent) => event.type === 'order-update'),
    map((event: OrderStreamEvent) => event.payload)
  );
}
