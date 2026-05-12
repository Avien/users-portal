import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { Order } from '@portal/users/utils';

const ORDERS_VIRTUAL_ROW_HEIGHT_PX = 52;

@Component({
  selector: 'orders-card',
  standalone: true,
  templateUrl: './orders-card.component.html',
  styleUrl: './orders-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScrollingModule, DecimalPipe],
})
export class OrdersCardComponent {
  readonly orders = input<Order[]>([]);
  readonly loading = input<boolean>(false);
  readonly loaded = input<boolean>(false);
  readonly error = input<string | null>(null);

  readonly ordersVirtualRowHeightPx = ORDERS_VIRTUAL_ROW_HEIGHT_PX;

  trackByOrderId(_index: number, order: Order): number {
    return order.id;
  }
}
