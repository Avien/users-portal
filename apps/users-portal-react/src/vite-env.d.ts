interface ImportMetaEnv {
  readonly VITE_ORDERS_WS_URL: string;
  // Unset in production — the widget's own default (same-origin /api/business-agent)
  // is correct there. Only needed locally, to point at tools/business-agent-server.ts.
  readonly VITE_BUSINESS_AGENT_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}