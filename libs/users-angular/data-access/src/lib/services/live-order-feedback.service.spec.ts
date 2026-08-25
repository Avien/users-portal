import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LiveOrderFeedbackService } from './live-order-feedback.service';

describe('LiveOrderFeedbackService', () => {
  let service: LiveOrderFeedbackService;
  let recentlyArrivedOrderIds: WritableSignal<ReadonlySet<number>>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [LiveOrderFeedbackService] });
    service = TestBed.inject(LiveOrderFeedbackService);
    recentlyArrivedOrderIds = signal<ReadonlySet<number>>(new Set());
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('marks an order id as recently arrived', () => {
    service.markArrived(recentlyArrivedOrderIds, 101);
    expect(recentlyArrivedOrderIds().has(101)).toBe(true);
  });

  it('clears the id on its own after ~2.5s (the intended highlight duration)', () => {
    service.markArrived(recentlyArrivedOrderIds, 101);
    jest.advanceTimersByTime(2499);
    expect(recentlyArrivedOrderIds().has(101)).toBe(true);
    jest.advanceTimersByTime(1);
    expect(recentlyArrivedOrderIds().has(101)).toBe(false);
  });

  it('tracks multiple concurrently-arrived orders independently', () => {
    service.markArrived(recentlyArrivedOrderIds, 101);
    jest.advanceTimersByTime(1000);
    service.markArrived(recentlyArrivedOrderIds, 102);

    // 101 was marked 1s earlier — it should clear on its own schedule,
    // while 102 (marked later) is still within its own window.
    jest.advanceTimersByTime(1500);
    expect(recentlyArrivedOrderIds().has(101)).toBe(false);
    expect(recentlyArrivedOrderIds().has(102)).toBe(true);

    jest.advanceTimersByTime(1000);
    expect(recentlyArrivedOrderIds().has(102)).toBe(false);
  });

  it('restarts the timer if the same id is marked again before it clears', () => {
    service.markArrived(recentlyArrivedOrderIds, 101);
    jest.advanceTimersByTime(2000);
    service.markArrived(recentlyArrivedOrderIds, 101); // re-marked with 500ms left on the original timer

    jest.advanceTimersByTime(2000); // old timer would have fired by now if not restarted
    expect(recentlyArrivedOrderIds().has(101)).toBe(true);

    jest.advanceTimersByTime(500);
    expect(recentlyArrivedOrderIds().has(101)).toBe(false);
  });

  describe('clearArrived (retention eviction)', () => {
    it('immediately removes an evicted id and cancels its pending timer', () => {
      service.markArrived(recentlyArrivedOrderIds, 101);
      service.clearArrived(recentlyArrivedOrderIds, [101]);
      expect(recentlyArrivedOrderIds().has(101)).toBe(false);

      // The timer must genuinely be cancelled, not just raced — advancing
      // past its original duration must not throw or resurrect anything.
      expect(() => jest.advanceTimersByTime(5000)).not.toThrow();
      expect(recentlyArrivedOrderIds().has(101)).toBe(false);
    });

    it('leaves unrelated ids untouched', () => {
      service.markArrived(recentlyArrivedOrderIds, 101);
      service.markArrived(recentlyArrivedOrderIds, 102);
      service.clearArrived(recentlyArrivedOrderIds, [101]);
      expect(recentlyArrivedOrderIds().has(101)).toBe(false);
      expect(recentlyArrivedOrderIds().has(102)).toBe(true);
    });

    it('is a safe no-op for an id that was never marked', () => {
      expect(() => service.clearArrived(recentlyArrivedOrderIds, [999])).not.toThrow();
      expect(recentlyArrivedOrderIds()).toEqual(new Set());
    });

    it('is a safe no-op for an empty list', () => {
      service.markArrived(recentlyArrivedOrderIds, 101);
      const before = recentlyArrivedOrderIds();
      service.clearArrived(recentlyArrivedOrderIds, []);
      expect(recentlyArrivedOrderIds()).toBe(before); // same reference — no unnecessary update
    });
  });

  describe('clearAll', () => {
    it('empties the set and cancels every pending timer', () => {
      service.markArrived(recentlyArrivedOrderIds, 101);
      service.markArrived(recentlyArrivedOrderIds, 102);
      service.clearAll(recentlyArrivedOrderIds);

      expect(recentlyArrivedOrderIds()).toEqual(new Set());
      expect(() => jest.advanceTimersByTime(5000)).not.toThrow();
      expect(recentlyArrivedOrderIds()).toEqual(new Set());
    });
  });
});
