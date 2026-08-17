export const environment = {
  ordersWsUrl: 'wss://users-portal-production.up.railway.app/orders',
  // Unset: the widget falls back to same-origin `/api/business-agent`, the target
  // prod architecture. That route isn't deployed yet — see docs/roadmap.md Phase 4.
  businessAgentEndpoint: undefined as string | undefined,
};