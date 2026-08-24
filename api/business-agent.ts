import type { IncomingMessage, ServerResponse } from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import {
  fetchOrdersSnapshot,
  parseAgentRequestBody,
  runAgent,
  formatUsageLog,
} from '../tools/business-agent-core';
import { readRequestBody, isJsonContentType, MAX_BODY_BYTES } from '../tools/business-agent-http';
import { mapErrorToResponse } from '../tools/business-agent-errors';

// The three imports above are deliberately EXTENSIONLESS, unlike most of
// tools/*.ts (which uses explicit .ts extensions because those files run
// directly via `tsx`, whose underlying Node ESM loader needs a full specifier).
// This file is bundled by Vercel's own builder instead — the same requirement
// every Vite-bundled file in this repo already follows (e.g.
// libs/business-agent-widget's internal imports). An explicit `.ts` extension
// here survives untranspiled into the compiled output as a literal
// require("...ts"), which Vercel's bundler does not trace/inline and Node
// cannot resolve at runtime — this broke a real Preview deployment
// ("Cannot find module '../tools/business-agent-core.ts'") before this fix.
// tools/business-agent-core.ts, tools/business-agent-errors.ts, and this file
// are the only three files that sit at this local-tsx/Vercel-bundle
// intersection, so they're the only ones using extensionless relative imports
// within the business-agent-* family.

// ─────────────────────────────────────────────────────────────────────────────
// Production serverless handler for POST /api/business-agent (Phase 4 — see
// docs/roadmap.md). Deliberately a THIN adapter: all agent logic lives in
// tools/business-agent-core.ts, shared unchanged with the local dev server
// (tools/business-agent-server.ts) — nothing here duplicates the tool-use loop,
// the business tools, or request validation.
//
// Placed at the true monorepo root (sibling to vercel.json), not inside any one
// app's subfolder — confirmed (Vercel dashboard, Settings → General → Root
// Directory) that all three deployed projects (users-portal-angular,
// users-portal-react, users-portal-vue) have Root Directory = ./ (the monorepo
// root), so this one file ships identically to all three deployments, giving
// genuine same-origin /api/business-agent for all three at once — no per-app
// duplication. If a project's Root Directory is ever repointed to a subfolder,
// that project would need its own copy of this file inside that subfolder
// (still importing this same shared core, never duplicating logic).
//
// Deliberately plain node:http types (IncomingMessage/ServerResponse), not
// @vercel/node's VercelRequest/VercelResponse — Vercel's Node.js Functions
// runtime accepts the raw Node request/response signature natively, so no new
// dependency is needed, and it keeps this handler's request/response shape
// identical to the dev adapter's.
//
// Environment variables — configured via each Vercel project's own Settings →
// Environment Variables, never a checked-in .env file, never read by the
// browser. Because these are three SEPARATE Vercel projects (even though all
// three share Root Directory = ./), every variable below must be set on EVERY
// project that serves this file, not just one:
//
//   REQUIRED
//   ANTHROPIC_API_KEY   the Claude API key. Server-side only.
//   ORDERS_API_URL      the canonical Orders snapshot endpoint, e.g.
//                       https://users-portal-production.up.railway.app/api/orders-snapshot
//                       Without this, getOrdersSnapshotUrl() falls back to
//                       http://localhost:3000/api/orders-snapshot (see
//                       tools/business-agent-core.ts) — unreachable from a
//                       Vercel function, so EVERY request would fail with a
//                       sanitized 503 ("Unable to retrieve current business
//                       data") after the retry backoff. This is not optional
//                       in production.
//
//   OPTIONAL
//   BUSINESS_AGENT_MODEL             overrides the runtime model (default: claude-sonnet-5)
//   BUSINESS_AGENT_ALLOWED_ORIGINS   explicit cross-origin allow-list (comma-separated).
//                                    Same-origin traffic from the app itself doesn't need
//                                    this — only relevant as defense-in-depth or if a
//                                    project's build ever serves a different origin.
//   BUSINESS_AGENT_USAGE_LOG         "1" to log aggregated per-query token/cost telemetry
//                                    to this function's own server-side logs
// ─────────────────────────────────────────────────────────────────────────────

export const config = { maxDuration: 60 };

// Module-scope singleton, reused across warm invocations — same pattern the
// local dev server already uses, just without the .env bootstrap (Vercel
// injects ANTHROPIC_API_KEY directly into process.env; there is no .env file in
// the deployed function's filesystem). Exported (not just module-private) so
// tests can substitute client.messages.stream with a fake, the same
// dependency-injection approach runAgent's own tests already use — a serverless
// function's fixed (req, res) signature leaves no other seam to pass a fake
// client through.
export const client = new Anthropic();

// Fail-closed by design — deliberately NOT tools/cors.mjs's shared default
// (which returns '*' when the allow-list env var is unset, a permissive
// default that's correct for local dev but must never ship to production).
// Same-origin requests from any of the three deployed apps are unaffected by
// this either way; only cross-origin callers are gated.
function resolveProductionCorsOrigin(requestOrigin: string | undefined, allowedOriginsEnvValue: string | undefined): string | null {
  if (!allowedOriginsEnvValue) return null;
  const allowed = allowedOriginsEnvValue.split(',').map((s) => s.trim()).filter(Boolean);
  return requestOrigin && allowed.includes(requestOrigin) ? requestOrigin : null;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const origin = resolveProductionCorsOrigin(
    req.headers.origin as string | undefined,
    process.env['BUSINESS_AGENT_ALLOWED_ORIGINS']
  );
  if (origin) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
  }
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found', message: 'POST /api/business-agent only' }));
    return;
  }

  try {
    if (!isJsonContentType(req.headers['content-type'])) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_request', message: 'Content-Type must be application/json.' }));
      return;
    }

    const rawBody = await readRequestBody(req, MAX_BODY_BYTES);
    const { prompt, history } = parseAgentRequestBody(rawBody);
    // Deliberately no prompt/history logging here, unlike the dev adapter —
    // production should not log complete user prompts by default.
    // BUSINESS_AGENT_USAGE_LOG below covers aggregated token/cost telemetry
    // only, never prompt content.
    const snapshot = await fetchOrdersSnapshot();
    const { usage, ...result } = await runAgent(client, prompt, snapshot, history);
    if (process.env['BUSINESS_AGENT_USAGE_LOG'] === '1') {
      console.log(formatUsageLog(usage, result.turns));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    // Full detail server-side only (Vercel's own function logs) — the response
    // body is always the sanitized mapping below, never err.message directly.
    console.error('[business-agent] request failed:', err);
    const { status, body } = mapErrorToResponse(err);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }
}
