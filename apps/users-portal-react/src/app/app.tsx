import { Navigate, Route, Routes } from 'react-router-dom';
import { UserOrders } from '@portal/users-react/feature';
import { useOrdersStream } from '@portal/users-react/data-access';

export function App() {
  useOrdersStream();
  return (
    <Routes>
      <Route path="/users/:userId" element={<UserOrders />} />
      <Route path="/users" element={<UserOrders />} />
      <Route path="*" element={<Navigate to="/users" replace />} />
    </Routes>
  );
}

export default App;
