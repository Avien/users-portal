import { Navigate, Route, Routes } from 'react-router-dom';
import { UserOrders } from '@portal/users-react/feature';
import { useOrdersStream } from '@portal/users-react/data-access';
import { ErrorBoundary } from '@portal/users-react/ui';

export function App({ enableWs = true }: { enableWs?: boolean }) {
  useOrdersStream(enableWs);
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/users/:userId" element={<UserOrders />} />
        <Route path="/users" element={<UserOrders />} />
        <Route path="*" element={<Navigate to="/users" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}

export default App;
