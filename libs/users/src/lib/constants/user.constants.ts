export const USERS_FEATURE_KEY = 'users';
export const ORDERS_FEATURE_KEY = 'orders';
export const DEFAULT_ORDERS_WS_URL = 'ws://localhost:3000/orders';

// Local-dev fallback only, exactly like DEFAULT_ORDERS_WS_URL above — production
// deployments must set VITE_ORDERS_API_URL explicitly (this is the frontend's
// plain Order[] endpoint; the Business Agent's server-side ORDERS_API_URL points
// at a separate atomic-snapshot endpoint and is configured independently).
export const DEFAULT_ORDERS_API_URL = 'http://localhost:3000/api/orders';
