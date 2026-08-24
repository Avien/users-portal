export const environment = {
  ordersApiUrl: 'https://users-portal-production.up.railway.app/api/orders',
  ordersWsUrl: 'wss://users-portal-production.up.railway.app/orders',
  reactRemoteUrl: 'https://users-portal-react.vercel.app/remoteEntry.js',
  // Unset: the widget falls back to same-origin `/api/business-agent`, the
  // production architecture — see docs/roadmap.md Phase 4.
  businessAgentEndpoint: undefined as string | undefined,
};