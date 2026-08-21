export const environment = {
  ordersApiUrl: 'http://localhost:3000/api/orders',
  ordersWsUrl: 'ws://localhost:3000/orders',
  // Matches start:react's VITE_BUSINESS_AGENT_ENDPOINT — dev business-agent server
  // runs on 8787, separate origin from ng serve's 4200.
  businessAgentEndpoint: 'http://localhost:8787/api/business-agent',
};