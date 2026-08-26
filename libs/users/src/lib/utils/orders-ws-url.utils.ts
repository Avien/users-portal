// Demo-owner/test traffic classification only (see docs/business-agent.md) —
// this is NOT authentication or authorization. A manually-set browser-local
// token, if present, is appended to the Orders WebSocket URL as
// `viewerToken` so the Railway backend can tag connections from it as
// `isExcludedClient: true` in its structured connection logs. When the token
// is absent (the default for every client without the owner/test
// classification token set), the URL is unchanged from today — this is
// purely additive.
//
// Shared here (not duplicated per framework) because Angular, React, and Vue
// each independently construct the same Orders WebSocket URL — this is the
// one place that needs to know about the token at all.
export const DEMO_OWNER_TOKEN_STORAGE_KEY = 'usersPortalDemoOwnerToken';

export function buildOrdersSocketUrl(baseUrl: string): string {
  let token: string | null = null;
  try {
    token = localStorage.getItem(DEMO_OWNER_TOKEN_STORAGE_KEY);
  } catch {
    // localStorage can throw (private browsing, disabled storage, a
    // non-browser environment) — fall back to no token rather than breaking
    // the connection over a classification nicety.
    token = null;
  }
  if (!token) return baseUrl;
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}viewerToken=${encodeURIComponent(token)}`;
}
