import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { loadRemote } from '@module-federation/runtime';

type MountFn = (
  container: HTMLElement,
  opts: { initialPath: string }
) => () => void;

@Component({
  selector: 'app-react-wrapper',
  standalone: true,
  template: `<div #reactRoot class="react-host"></div>`,
  styles: [`.react-host { height: 100%; }`],
})
export class ReactWrapperComponent implements AfterViewInit, OnDestroy {
  @ViewChild('reactRoot') container!: ElementRef<HTMLElement>;
  private unmount?: () => void;

  async ngAfterViewInit() {
    const mod = await loadRemote<{ mount: MountFn }>('react-users/mount');
    this.unmount = mod!.mount(this.container.nativeElement, {
      initialPath: '/users',
    });
  }

  ngOnDestroy() {
    this.unmount?.();
  }
}