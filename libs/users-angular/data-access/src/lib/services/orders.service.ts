import { inject, Injectable, InjectionToken } from '@angular/core';
import { filter, Observable, map, retry, tap } from 'rxjs';
import { webSocket } from 'rxjs/webSocket';
import { Order, DEFAULT_ORDERS_WS_URL } from '@portal/users/utils';

/** Matches MFE_ORDER_EVENT in @portal/users-react/data-access. */
const MFE_ORDER_EVENT = 'mfe:order-update';

interface OrderStreamEvent {
  type: 'order-update';
  payload: Order;
}

/** Override in tests or `app.config` when the mock server URL differs. */
export const ORDERS_SOCKET_URL = new InjectionToken<string>('ORDERS_SOCKET_URL', {
  factory: () => DEFAULT_ORDERS_WS_URL
});

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly url = inject(ORDERS_SOCKET_URL);
  private stream$ = webSocket<OrderStreamEvent>(this.url);

  public ordersUpdates$: Observable<Order> = this.stream$.pipe(
    filter((event: OrderStreamEvent) => event.type === 'order-update'),
    map((event: OrderStreamEvent) => event.payload),
    tap((order) => window.dispatchEvent(new CustomEvent(MFE_ORDER_EVENT, { detail: order }))),
    retry({ delay: 3000 })
  );
}
