import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { By } from '@angular/platform-browser';
import { Order } from '@portal/users/utils';
import { OrdersCardComponent } from './orders-card.component';

const ORDER_101: Order = { id: 101, userId: 1, total: 42, status: 'pending' };
const ORDER_102: Order = { id: 102, userId: 1, total: 99, status: 'completed' };

describe('OrdersCardComponent', () => {
  let fixture: ComponentFixture<OrdersCardComponent>;
  let getBoundingClientRectSpy: jest.SpyInstance;

  beforeEach(async () => {
    // jsdom performs no real layout — every element's getBoundingClientRect()
    // is always 0x0, which is what cdk-virtual-scroll-viewport uses to decide
    // its own size and, from that, which rows are "visible" enough to render.
    // Without this, the viewport always computes zero visible rows and
    // *cdkVirtualFor renders nothing, regardless of how many orders are
    // passed in — this stubs a real, non-zero size so it behaves as it would
    // in a real browser.
    getBoundingClientRectSpy = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 400,
      height: 400,
      top: 0,
      left: 0,
      bottom: 400,
      right: 400,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect);

    // jsdom does not implement Element.prototype.scrollTo at all — the CDK
    // viewport's scrollToIndex()/scrollTo() call it directly to perform the
    // actual scroll. Stub it so scrollToIndex can be spied on / doesn't throw.
    if (!('scrollTo' in HTMLElement.prototype)) {
      (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
    }

    await TestBed.configureTestingModule({
      imports: [OrdersCardComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(OrdersCardComponent);
    document.body.appendChild(fixture.nativeElement);
  });

  afterEach(() => {
    fixture.nativeElement.remove();
    getBoundingClientRectSpy.mockRestore();
  });

  async function renderAndCheckViewport(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    const viewport = fixture.debugElement.query(By.directive(CdkVirtualScrollViewport));
    (viewport?.injector.get(CdkVirtualScrollViewport) as CdkVirtualScrollViewport | undefined)?.checkViewportSize();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function rows(): HTMLElement[] {
    return fixture.debugElement.queryAll(By.css('.orders-row')).map((el) => el.nativeElement as HTMLElement);
  }

  it('renders a row per order, none highlighted by default', async () => {
    fixture.componentRef.setInput('orders', [ORDER_101, ORDER_102]);
    await renderAndCheckViewport();

    const rendered = rows();
    expect(rendered.length).toBeGreaterThan(0);
    for (const row of rendered) {
      expect(row.classList.contains('orders-row--new')).toBe(false);
    }
  });

  it('applies the "new" highlight class only to the row whose order id is in recentlyArrivedOrderIds', async () => {
    fixture.componentRef.setInput('orders', [ORDER_101, ORDER_102]);
    fixture.componentRef.setInput('recentlyArrivedOrderIds', new Set([101]));
    await renderAndCheckViewport();

    const highlighted = rows().filter((row) => row.classList.contains('orders-row--new'));
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].textContent).toContain('101');
  });

  it('removes the highlight once the id is no longer in recentlyArrivedOrderIds (e.g. the timer cleared it)', async () => {
    fixture.componentRef.setInput('orders', [ORDER_101]);
    fixture.componentRef.setInput('recentlyArrivedOrderIds', new Set([101]));
    await renderAndCheckViewport();
    expect(rows()[0].classList.contains('orders-row--new')).toBe(true);

    fixture.componentRef.setInput('recentlyArrivedOrderIds', new Set());
    await renderAndCheckViewport();

    expect(rows()[0].classList.contains('orders-row--new')).toBe(false);
  });

  it('defaults recentlyArrivedOrderIds to an empty set', () => {
    const component = fixture.componentInstance;
    expect(component.recentlyArrivedOrderIds().size).toBe(0);
  });

  function viewportInstance(): CdkVirtualScrollViewport | undefined {
    return fixture.debugElement.query(By.directive(CdkVirtualScrollViewport))
      ?.injector.get(CdkVirtualScrollViewport) as CdkVirtualScrollViewport | undefined;
  }

  describe('smart live-follow', () => {
    it('auto-scrolls to the last row when a new order arrives for the selected user while at the bottom', async () => {
      fixture.componentRef.setInput('selectedUserId', 1);
      fixture.componentRef.setInput('orders', [ORDER_101]);
      await renderAndCheckViewport();

      const scrollSpy = jest.spyOn(viewportInstance()!, 'scrollToIndex');

      fixture.componentRef.setInput('orders', [ORDER_101, ORDER_102]);
      fixture.componentRef.setInput('recentlyArrivedOrderIds', new Set([102]));
      await renderAndCheckViewport();
      await renderAndCheckViewport(); // let afterNextRender's callback flush

      expect(scrollSpy).toHaveBeenCalledWith(1, 'smooth');
    });

    it('the newest row carries the highlight class once it scrolls into view', async () => {
      fixture.componentRef.setInput('selectedUserId', 1);
      fixture.componentRef.setInput('orders', [ORDER_101]);
      await renderAndCheckViewport();

      fixture.componentRef.setInput('orders', [ORDER_101, ORDER_102]);
      fixture.componentRef.setInput('recentlyArrivedOrderIds', new Set([102]));
      await renderAndCheckViewport();
      await renderAndCheckViewport();

      const highlighted = rows().filter((row) => row.classList.contains('orders-row--new'));
      expect(highlighted.some((row) => row.textContent?.includes('102'))).toBe(true);
    });

    it('does not auto-scroll on HTTP hydration (orders growing without a matching recentlyArrivedOrderIds entry)', async () => {
      fixture.componentRef.setInput('selectedUserId', 1);
      fixture.componentRef.setInput('orders', [ORDER_101]);
      await renderAndCheckViewport();

      const scrollSpy = jest.spyOn(viewportInstance()!, 'scrollToIndex');

      fixture.componentRef.setInput('orders', [ORDER_101, ORDER_102]); // no recentlyArrivedOrderIds change
      await renderAndCheckViewport();
      await renderAndCheckViewport();

      expect(scrollSpy).not.toHaveBeenCalled();
    });

    it('does not force-scroll when the user has scrolled away from the bottom, and bumps the pending count instead', async () => {
      fixture.componentRef.setInput('selectedUserId', 1);
      fixture.componentRef.setInput('orders', [ORDER_101]);
      await renderAndCheckViewport();

      const viewport = viewportInstance()!;
      jest.spyOn(viewport, 'measureScrollOffset').mockReturnValue(500); // far from bottom
      viewport.getElementRef().nativeElement.dispatchEvent(new Event('scroll'));
      await renderAndCheckViewport();
      expect(fixture.componentInstance.liveFollow()).toBe(false);

      const scrollSpy = jest.spyOn(viewport, 'scrollToIndex');
      fixture.componentRef.setInput('orders', [ORDER_101, ORDER_102]);
      fixture.componentRef.setInput('recentlyArrivedOrderIds', new Set([102]));
      await renderAndCheckViewport();
      await renderAndCheckViewport();

      expect(scrollSpy).not.toHaveBeenCalled();
      expect(fixture.componentInstance.pendingNewOrdersCount()).toBe(1);
    });

    it('increments the pending count cleanly across multiple arrivals while paused', async () => {
      fixture.componentRef.setInput('selectedUserId', 1);
      fixture.componentRef.setInput('orders', [ORDER_101]);
      await renderAndCheckViewport();

      const viewport = viewportInstance()!;
      jest.spyOn(viewport, 'measureScrollOffset').mockReturnValue(500);
      viewport.getElementRef().nativeElement.dispatchEvent(new Event('scroll'));
      await renderAndCheckViewport();

      fixture.componentRef.setInput('orders', [ORDER_101, ORDER_102]);
      fixture.componentRef.setInput('recentlyArrivedOrderIds', new Set([102]));
      await renderAndCheckViewport();

      const order103: Order = { id: 103, userId: 1, total: 10, status: 'pending' };
      fixture.componentRef.setInput('orders', [ORDER_101, ORDER_102, order103]);
      fixture.componentRef.setInput('recentlyArrivedOrderIds', new Set([102, 103]));
      await renderAndCheckViewport();

      expect(fixture.componentInstance.pendingNewOrdersCount()).toBe(2);
    });

    it('shows the "+N new orders" indicator only while paused with a pending count', async () => {
      fixture.componentRef.setInput('selectedUserId', 1);
      fixture.componentRef.setInput('orders', [ORDER_101]);
      await renderAndCheckViewport();
      expect(fixture.debugElement.query(By.css('.new-orders-indicator'))).toBeNull();

      fixture.componentInstance.liveFollow.set(false);
      fixture.componentInstance.pendingNewOrdersCount.set(2);
      fixture.detectChanges();

      const indicator = fixture.debugElement.query(By.css('.new-orders-indicator'));
      expect(indicator).not.toBeNull();
      expect(indicator.nativeElement.textContent).toContain('+2 new orders');
    });

    it('clicking the indicator scrolls to the latest row, clears the pending count, and resumes live-follow', async () => {
      fixture.componentRef.setInput('selectedUserId', 1);
      fixture.componentRef.setInput('orders', [ORDER_101, ORDER_102]);
      await renderAndCheckViewport();

      const scrollSpy = jest.spyOn(viewportInstance()!, 'scrollToIndex');
      fixture.componentInstance.liveFollow.set(false);
      fixture.componentInstance.pendingNewOrdersCount.set(3);
      fixture.detectChanges();

      fixture.debugElement.query(By.css('.new-orders-indicator')).nativeElement.click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.componentInstance.liveFollow()).toBe(true);
      expect(fixture.componentInstance.pendingNewOrdersCount()).toBe(0);
      expect(scrollSpy).toHaveBeenCalledWith(1, 'smooth');
    });

    it('returning manually to the bottom resumes live-follow and clears the pending indicator', async () => {
      fixture.componentRef.setInput('selectedUserId', 1);
      fixture.componentRef.setInput('orders', [ORDER_101]);
      await renderAndCheckViewport();

      const viewport = viewportInstance()!;
      const measureSpy = jest.spyOn(viewport, 'measureScrollOffset');
      measureSpy.mockReturnValue(500);
      viewport.getElementRef().nativeElement.dispatchEvent(new Event('scroll'));
      await renderAndCheckViewport();
      expect(fixture.componentInstance.liveFollow()).toBe(false);

      fixture.componentInstance.pendingNewOrdersCount.set(2);

      measureSpy.mockReturnValue(0);
      viewport.getElementRef().nativeElement.dispatchEvent(new Event('scroll'));
      await renderAndCheckViewport();

      expect(fixture.componentInstance.liveFollow()).toBe(true);
      expect(fixture.componentInstance.pendingNewOrdersCount()).toBe(0);
    });

    it('resets live-follow/pending state when the selected user changes', async () => {
      fixture.componentRef.setInput('selectedUserId', 1);
      fixture.componentRef.setInput('orders', [ORDER_101]);
      await renderAndCheckViewport();

      const viewport = viewportInstance()!;
      jest.spyOn(viewport, 'measureScrollOffset').mockReturnValue(500);
      viewport.getElementRef().nativeElement.dispatchEvent(new Event('scroll'));
      await renderAndCheckViewport();
      fixture.componentInstance.pendingNewOrdersCount.set(4);
      expect(fixture.componentInstance.liveFollow()).toBe(false);

      fixture.componentRef.setInput('selectedUserId', 2);
      fixture.componentRef.setInput('orders', []);
      fixture.componentRef.setInput('recentlyArrivedOrderIds', new Set());
      await renderAndCheckViewport();

      expect(fixture.componentInstance.liveFollow()).toBe(true);
      expect(fixture.componentInstance.pendingNewOrdersCount()).toBe(0);
    });
  });

  describe('stable viewport height', () => {
    it('reserves the same height while loading, loaded-empty, and rendering the list', async () => {
      fixture.componentRef.setInput('loading', true);
      fixture.detectChanges();
      const wrapper = fixture.debugElement.query(By.css('.orders-viewport-wrapper')).nativeElement as HTMLElement;
      expect(wrapper.style.height).toBe('416px');

      fixture.componentRef.setInput('loading', false);
      fixture.componentRef.setInput('loaded', true);
      fixture.detectChanges();
      expect(wrapper.style.height).toBe('416px');

      fixture.componentRef.setInput('orders', [ORDER_101]);
      await renderAndCheckViewport();
      expect(wrapper.style.height).toBe('416px');
    });
  });
});
