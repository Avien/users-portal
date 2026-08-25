import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { Order } from '@portal/users/utils';

const ORDERS_VIRTUAL_ROW_HEIGHT_PX = 52;
const ORDERS_VISIBLE_ROWS = 8;
const ORDERS_VIEWPORT_HEIGHT_PX = ORDERS_VISIBLE_ROWS * ORDERS_VIRTUAL_ROW_HEIGHT_PX;
// "Reasonably near the bottom" for live-follow purposes — about one row's
// worth of scroll distance from the true bottom.
const NEAR_BOTTOM_THRESHOLD_PX = ORDERS_VIRTUAL_ROW_HEIGHT_PX;

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
  // Ephemeral presentation state only — see UsersFacade.$recentlyArrivedOrderIds.
  // A plain input (not a facade injection): this is a pure `ui`-layer
  // component, and module boundaries keep `type:ui` from depending on
  // `type:data-access` — the feature container passes this down.
  readonly recentlyArrivedOrderIds = input<ReadonlySet<number>>(new Set());
  // Purely so this component can tell "the selected user changed" apart from
  // "more of the same user's orders arrived", to reset its own live-follow /
  // pending-scroll state on switch — not used for anything else.
  readonly selectedUserId = input<number | null>(null);

  readonly ordersVirtualRowHeightPx = ORDERS_VIRTUAL_ROW_HEIGHT_PX;
  readonly ordersViewportHeightPx = ORDERS_VIEWPORT_HEIGHT_PX;

  private readonly viewport = viewChild(CdkVirtualScrollViewport);
  private readonly injector = inject(Injector);

  // Smart live-follow (Post-production / Portfolio Polish, see
  // docs/roadmap.md) — ephemeral UI/virtual-list-layer scroll state only;
  // not shared/domain state, and not a new WS subscription. Driven entirely
  // by recentlyArrivedOrderIds, which is already the source of truth for
  // "this was a genuine WS arrival for the currently-selected user."
  readonly liveFollow = signal(true);
  readonly pendingNewOrdersCount = signal(0);

  private previousArrivedIds: ReadonlySet<number> = new Set();
  private previousSelectedUserId: number | null = null;
  private hasInitialized = false;

  constructor() {
    // Attach/detach the raw scroll listener whenever the virtual-scroll
    // viewport mounts/unmounts (it only exists while orders().length > 0).
    effect((onCleanup) => {
      const viewport = this.viewport();
      if (!viewport) return;
      const subscription = viewport.elementScrolled().subscribe(() => this.handleScroll(viewport));
      onCleanup(() => subscription.unsubscribe());
    });

    effect(() => {
      const userId = this.selectedUserId();
      const arrived = this.recentlyArrivedOrderIds();

      // A different user entirely — start fresh rather than carrying over
      // scroll/pending state from whoever was selected before. Also covers
      // this component's very first run, so it never treats "everything
      // already in the input" as a batch of brand-new arrivals.
      const userChanged = !this.hasInitialized || userId !== this.previousSelectedUserId;
      this.hasInitialized = true;
      this.previousSelectedUserId = userId;
      if (userChanged) {
        this.liveFollow.set(true);
        this.pendingNewOrdersCount.set(0);
        this.previousArrivedIds = arrived;
        return;
      }

      const previous = this.previousArrivedIds;
      this.previousArrivedIds = arrived;
      const newlyArrivedCount = [...arrived].filter((id) => !previous.has(id)).length;
      if (newlyArrivedCount === 0) return;

      if (this.liveFollow()) {
        this.scrollToLatest();
      } else {
        this.pendingNewOrdersCount.update((count) => count + newlyArrivedCount);
      }
    });
  }

  resumeLiveFollow(): void {
    this.liveFollow.set(true);
    this.pendingNewOrdersCount.set(0);
    this.scrollToLatest();
  }

  trackByOrderId(_index: number, order: Order): number {
    return order.id;
  }

  private scrollToLatest(): void {
    const lastIndex = this.orders().length - 1;
    if (lastIndex < 0) return;
    // Wait for the next render so the new row actually exists in the
    // virtualizer's count before asking it to scroll there — no arbitrary
    // setTimeout needed.
    afterNextRender(() => this.viewport()?.scrollToIndex(lastIndex, 'smooth'), { injector: this.injector });
  }

  private handleScroll(viewport: CdkVirtualScrollViewport): void {
    const nearBottom = viewport.measureScrollOffset('bottom') <= NEAR_BOTTOM_THRESHOLD_PX;
    if (nearBottom) {
      this.liveFollow.set(true);
      this.pendingNewOrdersCount.set(0);
    } else {
      this.liveFollow.set(false);
    }
  }
}
