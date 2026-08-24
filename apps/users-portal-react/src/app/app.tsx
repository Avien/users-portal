import type { CSSProperties } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { UserOrders } from '@portal/users-react/feature';
import { useOrdersStream } from '@portal/users-react/data-access';
import { BusinessAgentPanel } from '@portal/business-agent-react';
// App-shell infrastructure, not Users/Orders domain UI — kept app-local rather
// than in @portal/users-react/ui (a type:app project may not depend on type:ui;
// this has no domain knowledge and only App itself ever uses it).
import { ErrorBoundary } from './error-boundary/error-boundary';

// Composed here, not inside UserOrders — the app is the composition root for two
// independent capabilities (Users/Orders feature + Business Agent). Neither owns
// the other: @portal/users-react/feature has no knowledge of Business Agent, and
// vice versa. See docs/roadmap.md Phase 3.
//
// Also owns the page-shell width/margin/padding for the whole /users page — both
// UserOrders and BusinessAgentPanel are direct children so they share exactly one
// column instead of each keeping its own copy of the same layout constants (this
// previously lived in UserOrders' own shellStyle; moved here now that the app
// composes two features into one page). A flex column stretches children to the
// full cross-axis width by default, so both land at the same width/left edge with
// no extra styling needed on either child; `gap` replaces the vertical spacing
// that used to come from shellStyle's own padding.
const pageShellStyle: CSSProperties = {
  maxWidth: 900,
  margin: '0 auto',
  padding: '2rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '2rem',
};

function UsersPage() {
  return (
    <div style={pageShellStyle}>
      <UserOrders />
      <BusinessAgentPanel />
    </div>
  );
}

export function App() {
  useOrdersStream();
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/users/:userId" element={<UsersPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="*" element={<Navigate to="/users" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}

export default App;
