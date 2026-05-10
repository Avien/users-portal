import { UserOrders } from '@portal/users-react/feature';
import { useOrdersStream } from '@portal/users-react/data-access';

export function App() {
  useOrdersStream();
  return <UserOrders />;
}

export default App;
