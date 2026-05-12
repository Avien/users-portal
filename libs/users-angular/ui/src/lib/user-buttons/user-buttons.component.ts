import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { User } from '@portal/users/utils';

@Component({
  selector: 'user-buttons',
  standalone: true,
  templateUrl: './user-buttons.component.html',
  styleUrl: './user-buttons.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserButtonsComponent {
  readonly users = input<User[]>([]);
  readonly selectedUserId = input<number | null>(null);
  readonly userSelected = output<number>();
}
