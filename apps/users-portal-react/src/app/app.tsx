import { Navigate, Route, Routes } from 'react-router-dom';
import { UserOrders } from '@portal/users-react/feature';
import { useOrdersStream } from '@portal/users-react/data-access';
import { ErrorBoundary } from '@portal/users-react/ui';
import { BusinessAgentPanel } from '@portal/business-agent-react';

// Composed here, not inside UserOrders — the app is the composition root for two
// independent capabilities (Users/Orders feature + Business Agent). Neither owns
// the other: @portal/users-react/feature has no knowledge of Business Agent, and
// vice versa. See docs/roadmap.md Phase 3.
function UsersPage() {
  return (
    <>
      <UserOrders />
      <BusinessAgentPanel />
    </>
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
