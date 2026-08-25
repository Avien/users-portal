import { memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, Dispatch, Ref, SetStateAction } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Order } from '@portal/users/utils';
import styles from './orders-card.module.css';

interface OrdersCardProps {
  orders: Order[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  recentlyArrivedOrderIds: ReadonlySet<number>;
  // Purely so this component can tell "the selected user changed" apart from
  // "more of the same user's orders arrived", to reset its own live-follow /
  // pending-scroll state on switch — not used for anything else.
  selectedUserId: number | null;
}

const ROW_HEIGHT = 52;
const VISIBLE_ROWS = 8;
const VIEWPORT_HEIGHT = VISIBLE_ROWS * ROW_HEIGHT;
// "Reasonably near the bottom" for live-follow purposes — about one row's
// worth of scroll distance from the true bottom.
const NEAR_BOTTOM_THRESHOLD_PX = ROW_HEIGHT;

interface OrdersListHandle {
  scrollToLatest: () => void;
}

export const OrdersCard = memo(function OrdersCard({
  orders,
  loading,
  loaded,
  error,
  recentlyArrivedOrderIds,
  selectedUserId,
}: OrdersCardProps) {
  // Smart live-follow (Post-production / Portfolio Polish, see
  // docs/roadmap.md) — ephemeral UI/virtual-list-layer scroll state only;
  // not shared/domain state, and not a new WS subscription. Driven entirely
  // by recentlyArrivedOrderIds, which is already the source of truth for
  // "this was a genuine WS arrival for the currently-selected user."
  const [liveFollow, setLiveFollow] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const listRef = useRef<OrdersListHandle>(null);

  // A different user entirely — start fresh rather than carrying over
  // scroll/pending state from whoever was selected before.
  useEffect(() => {
    setLiveFollow(true);
    setPendingCount(0);
  }, [selectedUserId]);

  const resumeLiveFollow = useCallback(() => {
    setLiveFollow(true);
    setPendingCount(0);
    listRef.current?.scrollToLatest();
  }, []);

  return (
    <div style={cardStyle}>
      <div style={headerRowStyle}>
        <h2 style={{ margin: 0 }}>Orders</h2>
        {!liveFollow && pendingCount > 0 && (
          <button type="button" style={indicatorStyle} onClick={resumeLiveFollow}>
            +{pendingCount} new order{pendingCount === 1 ? '' : 's'} ↓
          </button>
        )}
      </div>
      <div style={viewportStyle} data-testid="orders-viewport">
        {error ? (
          <p style={errorStyle}>{error}</p>
        ) : loading ? (
          <p style={mutedStyle}>Loading orders...</p>
        ) : orders.length > 0 ? (
          <OrdersList
            ref={listRef}
            orders={orders}
            recentlyArrivedOrderIds={recentlyArrivedOrderIds}
            selectedUserId={selectedUserId}
            liveFollow={liveFollow}
            onLiveFollowChange={setLiveFollow}
            onPendingCountChange={setPendingCount}
          />
        ) : loaded ? (
          <p style={mutedStyle}>No orders for this user.</p>
        ) : null}
      </div>
    </div>
  );
});

// ─── OrdersList ──────────────────────────────────────────────────────────────

interface OrdersListProps {
  orders: Order[];
  recentlyArrivedOrderIds: ReadonlySet<number>;
  selectedUserId: number | null;
  liveFollow: boolean;
  onLiveFollowChange: (value: boolean) => void;
  onPendingCountChange: Dispatch<SetStateAction<number>>;
  ref?: Ref<OrdersListHandle>;
}

const OrdersList = memo(function OrdersList({
  orders,
  recentlyArrivedOrderIds,
  selectedUserId,
  liveFollow,
  onLiveFollowChange,
  onPendingCountChange,
  ref,
}: OrdersListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: orders.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 3,
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollToLatest: () => {
        if (orders.length === 0) return;
        virtualizer.scrollToIndex(orders.length - 1, { align: 'end', behavior: 'smooth' });
      },
    }),
    [orders.length, virtualizer]
  );

  // Genuine WS arrivals for the selected user — recentlyArrivedOrderIds is
  // only ever populated from a WS event (see useOrdersStream's ws.onmessage),
  // never HTTP hydration — either auto-scroll to the newest row (live-follow)
  // or bump the pending indicator (paused, user scrolled away to inspect
  // older orders). Waits for the next commit (this effect) so the new row
  // already exists in the virtualizer's count before scrolling to it.
  const previousArrivedRef = useRef<ReadonlySet<number>>(recentlyArrivedOrderIds);
  const previousUserIdRef = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    const userChanged = previousUserIdRef.current === undefined || previousUserIdRef.current !== selectedUserId;
    previousUserIdRef.current = selectedUserId;
    if (userChanged) {
      previousArrivedRef.current = recentlyArrivedOrderIds;
      return;
    }

    const previous = previousArrivedRef.current;
    previousArrivedRef.current = recentlyArrivedOrderIds;
    const newlyArrivedCount = [...recentlyArrivedOrderIds].filter((id) => !previous.has(id)).length;
    if (newlyArrivedCount === 0) return;

    if (liveFollow) {
      if (orders.length > 0) virtualizer.scrollToIndex(orders.length - 1, { align: 'end', behavior: 'smooth' });
    } else {
      onPendingCountChange((count) => count + newlyArrivedCount);
    }
  }, [recentlyArrivedOrderIds, selectedUserId, liveFollow, orders.length, virtualizer, onPendingCountChange]);

  // "Do not fight the user" — stop auto-scrolling once they scroll away from
  // the bottom to inspect older orders, and resume (clearing the pending
  // indicator) once they scroll back near it.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const nearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX;
      onLiveFollowChange(nearBottom);
      if (nearBottom) onPendingCountChange(0);
    };
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [onLiveFollowChange, onPendingCountChange]);

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
            <OrderRow
              order={orders[virtualRow.index]}
              isNew={recentlyArrivedOrderIds.has(orders[virtualRow.index].id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── OrderRow ────────────────────────────────────────────────────────────────

const OrderRow = memo(function OrderRow({ order, isNew }: { order: Order; isNew: boolean }) {
  return (
    <div style={rowStyle} className={isNew ? styles['rowNew'] : undefined} role="listitem">
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

const headerRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.75rem',
  marginBottom: '0.75rem',
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

// Smart live-follow "paused" indicator — clicking it scrolls to the latest
// row, clears the pending count, and resumes live-follow.
const indicatorStyle: CSSProperties = {
  border: 'none',
  borderRadius: 999,
  padding: '0.3rem 0.75rem',
  background: '#0f766e',
  color: '#fff',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
