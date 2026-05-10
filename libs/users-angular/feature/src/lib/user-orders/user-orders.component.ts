import { ChangeDetectionStrategy, Component, inject, OnInit, Signal } from '@angular/core';
import { UsersFacade } from '@portal/users-angular/data-access';
import { UserOrdersVm } from '@portal/users/utils';
import {
  ToastStackComponent,
  UserNameComponent,
  UserTotalOrdersComponent,
  UserButtonsComponent,
  OrdersCardComponent,
} from '@portal/users-angular/ui';

@Component({
  selector: 'fmr-user-orders',
  standalone: true,
  imports: [
    ToastStackComponent,
    UserNameComponent,
    UserTotalOrdersComponent,
    UserButtonsComponent,
    OrdersCardComponent,
  ],
  templateUrl: './user-orders.component.html',
  styleUrl: './user-orders.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserOrdersComponent implements OnInit {
  private readonly facade = inject(UsersFacade);

  readonly $vm: Signal<UserOrdersVm> = this.facade.$vm;

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
