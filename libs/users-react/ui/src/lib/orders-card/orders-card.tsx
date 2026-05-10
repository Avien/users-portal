import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { Order } from '@portal/users-angular/utils';

interface OrdersCardProps {
  orders: Order[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

export const OrdersCard = memo(function OrdersCard({ orders, loading, loaded, error }: OrdersCardProps) {
  return (
    <div style={cardStyle}>
      <h2 style={{ margin: '0 0 0.75rem' }}>Orders</h2>
      {error ? (
        <p style={errorStyle}>{error}</p>
      ) : loading ? (
        <p style={mutedStyle}>Loading orders...</p>
      ) : orders.length > 0 ? (
        <ul style={listStyle} role="list" aria-label="Orders">
          {orders.map((order) => (
            <OrderRow key={order.id} order={order} />
          ))}
        </ul>
      ) : loaded ? (
        <p style={mutedStyle}>No orders for this user.</p>
      ) : null}
    </div>
  );
});

// ─── OrderRow ────────────────────────────────────────────────────────────────

const OrderRow = memo(function OrderRow({ order }: { order: Order }) {
  return (
    <li style={rowStyle} role="listitem">
      <span>#{order.id}</span>
      <strong>{order.total.toFixed(2)}</strong>
    </li>
  );
});

// ─── Styles ──────────────────────────────────────────────────────────────────

const cardStyle: CSSProperties = {
  padding: '1rem',
  border: '1px solid #d8dbe2',
  borderRadius: 12,
  background: '#fff',
};

const listStyle: CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  border: '1px solid #eef2f6',
  borderRadius: 8,
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: 52,
  padding: '0 10px',
  borderBottom: '1px solid #eef2f6',
  boxSizing: 'border-box',
};

const mutedStyle: CSSProperties = { color: '#667085', margin: 0 };
const errorStyle: CSSProperties = { color: '#dc2626', margin: 0 };
