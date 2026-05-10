export type NotificationSeverity = 'warning' | 'critical';

export interface Notification {
  id: string;
  severity: NotificationSeverity;
  message: string;
  timestamp: number;
}
