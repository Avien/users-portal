import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Notification } from '@fmr/users-angular/utils';

@Component({
  selector: 'fmr-toast-stack',
  standalone: true,
  templateUrl: './toast-stack.component.html',
  styleUrl: './toast-stack.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ToastStackComponent {
  readonly notifications = input<Notification[]>([]);
  readonly dismissed = output<string>();

  dismiss(id: string) {
    this.dismissed.emit(id);
  }
}
