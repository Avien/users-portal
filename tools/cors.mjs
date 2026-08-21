// Shared by tools/mock-orders-ws-server.mjs and tools/business-agent-server.ts.
//
// Local dev (no env var set): permissive wildcard — up to four local ports
// (4000/4200/4201/4202) legitimately need to reach these servers, and hand-listing
// them would just be friction with no real security benefit on localhost.
//
// Production: set the relevant *_ALLOWED_ORIGINS env var to a comma-separated list
// of real origins (the deployed Vercel URLs) to switch to strict per-origin
// allow-listing instead of a wildcard.

export function resolveCorsOrigin(requestOrigin, allowedOriginsEnvValue) {
  if (!allowedOriginsEnvValue) return '*';
  const allowed = allowedOriginsEnvValue
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return requestOrigin && allowed.includes(requestOrigin) ? requestOrigin : null;
}

export function applyCors(req, res, allowedOriginsEnvValue, methods = 'GET, OPTIONS') {
  const origin = resolveCorsOrigin(req.headers.origin, allowedOriginsEnvValue);
  if (origin) {
    res.setHeader('access-control-allow-origin', origin);
    if (origin !== '*') res.setHeader('vary', 'origin');
  }
  res.setHeader('access-control-allow-methods', methods);
  res.setHeader('access-control-allow-headers', 'content-type');
}
