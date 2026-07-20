import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import { loadRemote } from '@module-federation/runtime';
import { type MountMfe } from '@portal/platform';
import { PlatformService } from '../platform/platform.service';

@Component({
  selector: 'app-react-wrapper',
  standalone: true,
  template: `<div #reactRoot class="react-host"></div>`,
  styles: [`.react-host { height: 100%; }`],
})
export class ReactWrapperComponent implements AfterViewInit, OnDestroy {
  @ViewChild('reactRoot') container!: ElementRef<HTMLElement>;
  private unmount?: () => void;

  // Consume the shell's platform singleton — the wrapper never builds its own.
  private readonly platform = inject(PlatformService);

  async ngAfterViewInit() {
    const mod = await loadRemote<{ mount: MountMfe }>('react-users/mount');
    this.unmount = mod!.mount(this.container.nativeElement, {
      initialPath: '/users',
      platform: this.platform.sdk,
    });
  }

  ngOnDestroy() {
    this.unmount?.();
  }
}