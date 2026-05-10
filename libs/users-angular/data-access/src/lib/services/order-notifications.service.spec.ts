import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Notification } from '@portal/users-angular/utils';
import { OrderNotificationsService } from './order-notifications.service';

describe('OrderNotificationsService', () => {
  let service: OrderNotificationsService;
  let notifications: WritableSignal<Notification[]>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [OrderNotificationsService]
    });
    service = TestBed.inject(OrderNotificationsService);
    notifications = signal<Notification[]>([]);
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should append a notification with id, message, severity, and timestamp', () => {
    service.enqueue(notifications, { severity: 'warning', message: 'High total' });

    expect(notifications()).toHaveLength(1);
    expect(notifications()[0]).toMatchObject({
      severity: 'warning',
      message: 'High total'
    });
    expect(notifications()[0].id.length).toBeGreaterThan(0);
    expect(notifications()[0].timestamp).toBe(Date.now());
  });

  it('should remove a notification when dismiss is called', () => {
    service.enqueue(notifications, { severity: 'warning', message: 'A' });
    const id = notifications()[0].id;

    service.dismiss(notifications, id);

    expect(notifications()).toEqual([]);
  });

  it('should auto-dismiss warning notifications after the warning interval', () => {
    service.enqueue(notifications, { severity: 'warning', message: 'Auto' });
    expect(notifications()).toHaveLength(1);

    jest.advanceTimersByTime(10_000);

    expect(notifications()).toEqual([]);
  });

  it('should auto-dismiss critical notifications after the critical interval', () => {
    service.enqueue(notifications, { severity: 'critical', message: 'Burst' });
    expect(notifications()).toHaveLength(1);

    jest.advanceTimersByTime(20_000);

    expect(notifications()).toEqual([]);
  });

  it('should clear all notifications and cancel pending auto-dismiss timers', () => {
    service.enqueue(notifications, { severity: 'warning', message: '1' });
    service.enqueue(notifications, { severity: 'critical', message: '2' });
    expect(notifications()).toHaveLength(2);

    service.clearAll(notifications);

    expect(notifications()).toEqual([]);
    jest.advanceTimersByTime(30_000);
    expect(notifications()).toEqual([]);
  });

  it('should not throw when dismissing an unknown id', () => {
    service.enqueue(notifications, { severity: 'warning', message: 'Keep' });

    expect(() => service.dismiss(notifications, 'non-existent-id')).not.toThrow();
    expect(notifications()).toHaveLength(1);
  });
});
