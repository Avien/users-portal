import type { CSSProperties } from 'react';
import { useUsersFacade } from '../use-users-facade';
import { UserButtons, SummaryCards, OrdersCard } from '@fmr/users-react/ui';
import styles from './user-orders.module.css';

export function UserOrders() {
  const { users, loading, loaded, error, selectedUserId, selectedUserSummary, orders, selectUser } =
    useUsersFacade();

  return (
    <section style={shellStyle}>
      <header style={pageHeaderStyle}>
        <h1 style={{ margin: '0 0 0.5rem' }}>Users orders dashboard</h1>
        <div style={subtitleRowStyle}>
          <p style={{ margin: 0, color: '#667085' }}>Facade-driven example with TanStack Query and React.</p>
          <span className={`${styles.spinner} ${loading ? '' : styles.hidden}`} aria-label="Loading" />
        </div>
      </header>

      {error && <p style={errorStyle}>{error}</p>}

      <UserButtons users={users} selectedUserId={selectedUserId} onSelect={selectUser} />

      {selectedUserSummary ? (
        <>
          <SummaryCards summary={selectedUserSummary} />
          <OrdersCard orders={orders} loading={ordersLoading(loading, selectedUserId)} loaded={loaded} error={error} />
        </>
      ) : !loading && loaded ? (
        <p style={emptyStateStyle}>Select a user</p>
      ) : null}
    </section>
  );
}

function ordersLoading(globalLoading: boolean, selectedUserId: number | null): boolean {
  return globalLoading && selectedUserId !== null;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const shellStyle: CSSProperties = { maxWidth: 900, margin: '0 auto', padding: '2rem' };
const pageHeaderStyle: CSSProperties = { marginBottom: '1.5rem' };
const subtitleRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
const errorStyle: CSSProperties = { color: '#dc2626' };
const emptyStateStyle: CSSProperties = { padding: '1rem', color: '#667085' };
