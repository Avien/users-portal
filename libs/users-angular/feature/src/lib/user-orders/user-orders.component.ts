import { ChangeDetectionStrategy, Component, inject, OnInit, Signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { UsersFacade } from '@fmr/users-angular/data-access';
import { Order, UserOrdersVm } from '@fmr/users-angular/utils';
import { ToastStackComponent, UserNameComponent, UserTotalOrdersComponent } from '@fmr/users-angular/ui';

/** Must match `.orders-row` height in `user-orders.component.scss` for CDK virtual scroll. */
const ORDERS_VIRTUAL_ROW_HEIGHT_PX = 52;

@Component({
  selector: 'fmr-user-orders',
  standalone: true,
  imports: [
    ScrollingModule,
    ToastStackComponent,
    UserNameComponent,
    UserTotalOrdersComponent,
    DecimalPipe
  ],
  templateUrl: './user-orders.component.html',
  styleUrl: './user-orders.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserOrdersComponent implements OnInit {
  private readonly facade = inject(UsersFacade);

  readonly $vm: Signal<UserOrdersVm> = this.facade.$vm;

  /** Fixed row height (px) for `cdk-virtual-scroll-viewport` `itemSize`. */
  readonly ordersVirtualRowHeightPx = ORDERS_VIRTUAL_ROW_HEIGHT_PX;

  trackByOrderId(_index: number, order: Order): number {
    return order.id;
  }

  ngOnInit(): void {
    this.facade.loadUsers();
  }

  selectUser(userId: number): void {
    this.facade.selectUser(userId);
  }

  dismissOrderNotification(id: string): void {
    this.facade.dismissOrderNotification(id);
  }
}
