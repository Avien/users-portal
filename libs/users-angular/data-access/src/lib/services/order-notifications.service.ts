import { Injectable, WritableSignal } from '@angular/core';
import { Notification, NotificationSeverity, OrderMonitoringToastPayload } from '@portal/users/utils';

/**
 * Order notification UI mechanics: ids, auto-dismiss timers, list mutations.
 * Domain rules for *when* to notify live in `@portal/users/utils` (`reduceOrderMonitoring`);
 * the facade owns the writable notification list exposed on `$vm`.
 */
@Injectable({ providedIn: 'root' })
export class OrderNotificationsService {
  private readonly dismissTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private notificationSeq = 0;
  private readonly autoDismissMs: Record<NotificationSeverity, number> = {
    warning: 10_000,
    critical: 20_000
  };

  enqueue(notifications: WritableSignal<Notification[]>, payload: OrderMonitoringToastPayload): void {
    const id = this.createNotificationId();
    const notification: Notification = {
      ...payload,
      id,
      timestamp: Date.now()
    };
    notifications.update((list) => [...list, notification]);
    const timerId = setTimeout(
      () => this.dismiss(notifications, id),
      this.autoDismissMs[payload.severity]
    );
    this.dismissTimers.set(id, timerId);
  }

  dismiss(notifications: WritableSignal<Notification[]>, id: string): void {
    const timerId = this.dismissTimers.get(id);
    if (timerId != null) {
      clearTimeout(timerId);
    }
    this.dismissTimers.delete(id);
    notifications.update((list) => list.filter((n) => n.id !== id));
  }

  clearAll(notifications: WritableSignal<Notification[]>): void {
    for (const timerId of this.dismissTimers.values()) {
      clearTimeout(timerId);
    }
    this.dismissTimers.clear();
    notifications.set([]);
  }

  private createNotificationId(): string {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
      return cryptoApi.randomUUID();
    }
    this.notificationSeq += 1;
    return `order-monitoring-${Date.now()}-${this.notificationSeq}`;
  }
}
