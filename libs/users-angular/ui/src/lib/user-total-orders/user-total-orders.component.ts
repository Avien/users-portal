import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'fmr-user-total-orders',
  standalone: true,
  templateUrl: './user-total-orders.component.html',
  styleUrl: './user-total-orders.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule]
})
export class UserTotalOrdersComponent {
  readonly totalAmount = input<number>(0);
}
