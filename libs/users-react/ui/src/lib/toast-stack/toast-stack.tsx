import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { Notification } from '@portal/users/utils';

interface ToastStackProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
}

export const ToastStack = memo(function ToastStack({ notifications, onDismiss }: ToastStackProps) {
  return (
    <div style={stackStyle} aria-live="polite" aria-relevant="additions">
      {notifications.map((n) => (
        <div key={n.id} style={n.severity === 'critical' ? criticalStyle : warningStyle}>
          <div style={titleStyle}>{n.severity === 'critical' ? 'Critical' : 'Warning'}</div>
          <div style={messageStyle}>{n.message}</div>
          <button style={closeStyle} type="button" aria-label="Dismiss notification" onClick={() => onDismiss(n.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
});

// ─── Styles ──────────────────────────────────────────────────────────────────

const stackStyle: CSSProperties = {
  position: 'fixed',
  top: 16,
  right: 16,
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  width: 'min(360px, calc(100vw - 32px))',
  pointerEvents: 'none',
};

const toastBase: CSSProperties = {
  pointerEvents: 'auto',
  borderRadius: 10,
  padding: '10px 12px',
  boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
  border: '1px solid rgba(0,0,0,0.08)',
  background: '#f8fafc',
  position: 'relative',
};

const warningStyle: CSSProperties = {
  ...toastBase,
  borderColor: 'rgba(234,179,8,0.55)',
  background: 'rgba(254,243,199,0.95)',
};

const criticalStyle: CSSProperties = {
  ...toastBase,
  borderColor: 'rgba(220,38,38,0.55)',
  background: 'rgba(254,226,226,0.95)',
};

const titleStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.02em',
  textTransform: 'uppercase',
  marginBottom: 4,
};

const messageStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.35,
  paddingRight: 22,
};

const closeStyle: CSSProperties = {
  position: 'absolute',
  top: 6,
  right: 8,
  border: 0,
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 18,
  lineHeight: 1,
  color: 'rgba(0,0,0,0.55)',
};
