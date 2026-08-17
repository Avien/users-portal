import { memo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Order } from '@portal/users/utils';

interface OrdersCardProps {
  orders: Order[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

const ROW_HEIGHT = 52;
const VISIBLE_ROWS = 8;
const VIEWPORT_HEIGHT = VISIBLE_ROWS * ROW_HEIGHT;

export const OrdersCard = memo(function OrdersCard({ orders, loading, loaded, error }: OrdersCardProps) {
  return (
    <div style={cardStyle}>
      <h2 style={{ margin: '0 0 0.75rem' }}>Orders</h2>
      <div style={viewportStyle}>
        {error ? (
          <p style={errorStyle}>{error}</p>
        ) : loading ? (
          <p style={mutedStyle}>Loading orders...</p>
        ) : orders.length > 0 ? (
          <OrdersList orders={orders} />
        ) : loaded ? (
          <p style={mutedStyle}>No orders for this user.</p>
        ) : null}
      </div>
    </div>
  );
});

// ─── OrdersList ──────────────────────────────────────────────────────────────

const OrdersList = memo(function OrdersList({ orders }: { orders: Order[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: orders.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 3,
  });

  return (
    <div
      ref={scrollRef}
      style={{ ...listStyle, height: VIEWPORT_HEIGHT, overflowY: 'auto' }}
      role="list"
      aria-label="Orders"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            style={{
              position: 'absolute',
              top: 0,
              transform: `translateY(${virtualRow.start}px)`,
              width: '100%',
            }}
          >
            <OrderRow order={orders[virtualRow.index]} />
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── OrderRow ────────────────────────────────────────────────────────────────

const OrderRow = memo(function OrderRow({ order }: { order: Order }) {
  return (
    <div style={rowStyle} role="listitem">
      <span>#{order.id}</span>
      <strong>{order.total.toFixed(2)}</strong>
    </div>
  );
});

// ─── Styles ──────────────────────────────────────────────────────────────────

const cardStyle: CSSProperties = {
  padding: '1rem',
  border: '1px solid #d8dbe2',
  borderRadius: 12,
  background: '#fff',
};

// Fixed height regardless of state (loading/empty/error/list) — this is what
// keeps content below OrdersCard (Business Agent) from shifting vertically when
// switching users or during the mock loading latency.
const viewportStyle: CSSProperties = {
  height: VIEWPORT_HEIGHT,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start', // top-aligns loading/empty/error text; no effect on the list, which already fills the box
};

const listStyle: CSSProperties = {
  border: '1px solid #eef2f6',
  borderRadius: 8,
  overflow: 'hidden',
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
