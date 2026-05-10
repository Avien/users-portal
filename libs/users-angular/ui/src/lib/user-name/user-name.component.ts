import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'fmr-user-name',
  standalone: true,
  templateUrl: './user-name.component.html',
  styleUrl: './user-name.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserNameComponent {
  readonly userName = input<string>('');
}
