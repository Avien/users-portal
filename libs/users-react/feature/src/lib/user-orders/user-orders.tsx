import type { CSSProperties } from 'react';
import { useUsersFacade } from '../use-users-facade';
import { UserButtons, UserName, UserTotalOrders, OrdersCard, ToastStack } from '@portal/users-react/ui';
import styles from './user-orders.module.css';

export function UserOrders() {
  const {
    users,
    loading,
    loaded,
    error,
    selectedUserId,
    selectedUserSummary,
    orders,
    selectUser,
    notifications,
    dismissOrderNotification,
    recentlyArrivedOrderIds,
    unseenOrderCountsByUserId,
  } = useUsersFacade();

  return (
    <>
    <ToastStack notifications={notifications} onDismiss={dismissOrderNotification} />
    <section>
      <header style={pageHeaderStyle}>
        <h1 style={{ margin: '0 0 0.5rem' }}>Users orders dashboard</h1>
        <div style={subtitleRowStyle}>
          <p style={{ margin: 0, color: '#667085' }}>Facade-driven example with TanStack Query and React.</p>
          <span className={`${styles.spinner} ${loading ? '' : styles.hidden}`} aria-label="Loading" />
        </div>
      </header>

      {error && <p style={errorStyle}>{error}</p>}

      <UserButtons
        users={users}
        selectedUserId={selectedUserId}
        onSelect={selectUser}
        unseenOrderCounts={unseenOrderCountsByUserId}
      />

      {selectedUserSummary ? (
        <>
          <div style={summaryGridStyle}>
            <UserName userName={selectedUserSummary.userName} />
            <UserTotalOrders totalAmount={selectedUserSummary.totalAmount} />
          </div>
          <OrdersCard
            orders={orders}
            loading={ordersLoading(loading, selectedUserId)}
            loaded={loaded}
            error={error}
            recentlyArrivedOrderIds={recentlyArrivedOrderIds}
            selectedUserId={selectedUserId}
          />
        </>
      ) : !loading && loaded ? (
        <p style={emptyStateStyle}>Select a user</p>
      ) : null}
    </section>
    </>
  );
}

function ordersLoading(globalLoading: boolean, selectedUserId: number | null): boolean {
  return globalLoading && selectedUserId !== null;
}

// ─── Styles ──────────────────────────────────────────────────────────────────
// Page-shell width/margin/padding lives at the app composition root (app.tsx),
// not here — the app composes UserOrders alongside other features on /users and
// owns the shared column they both align to.

const pageHeaderStyle: CSSProperties = { marginBottom: '1.5rem' };
const subtitleRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
const summaryGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '1rem',
  marginBottom: '1.5rem',
};
const errorStyle: CSSProperties = { color: '#dc2626' };
const emptyStateStyle: CSSProperties = { padding: '1rem', color: '#667085' };
