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
  // Ephemeral presentation state only — see UsersFacade.$unseenOrderCountsByUserId.
  // A plain input, same reasoning as OrdersCardComponent.recentlyArrivedOrderIds:
  // `ui`-layer components don't reach into data-access, the feature container
  // passes this down.
  readonly unseenOrderCounts = input<Readonly<Record<number, number>>>({});
  readonly userSelected = output<number>();

  unseenCountFor(userId: number): number {
    return this.unseenOrderCounts()[userId] ?? 0;
  }

  // Accessible name including the unseen count — not color/badge alone (see
  // the visually-hidden-from-AT badge span in the template). Returns null
  // (Angular then removes the attribute entirely, not the string "null") for
  // the selected user or a zero count, so the button's accessible name falls
  // back to its own visible text with no behavior change.
  ariaLabelFor(user: User): string | null {
    const count = this.unseenCountFor(user.id);
    if (count === 0 || this.selectedUserId() === user.id) return null;
    return `${user.name}, ${count} new order${count === 1 ? '' : 's'}`;
  }
}
