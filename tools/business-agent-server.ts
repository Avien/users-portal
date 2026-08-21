import Anthropic from '@anthropic-ai/sdk';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyCors } from './cors.mjs';
import {
  fetchOrdersSnapshot,
  parseAgentRequestBody,
  runAgent,
  formatUsageLog,
} from './business-agent-core.ts';
import { readRequestBody, isJsonContentType, MAX_BODY_BYTES } from './business-agent-http.ts';
import { mapErrorToResponse } from './business-agent-errors.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Local dev HTTP adapter for the Product-Facing Business AI Agent (see
// docs/roadmap.md). All agent logic lives in tools/business-agent-core.ts —
// this file is only the node:http boundary: env loading, CORS, request/response
// wiring, and console logging. The production serverless handler
// (api/business-agent.ts) is the other adapter over that same core.
//
//   ANTHROPIC_API_KEY=... npm run business-agent
//   curl -s localhost:8787/api/business-agent -X POST \
//     -H 'content-type: application/json' \
//     -d '{"prompt":"Which users need attention based on recent high-value orders?"}'
//
//   BUSINESS_AGENT_MODEL=...        override the runtime model (default: claude-sonnet-5)
//   BUSINESS_AGENT_USAGE_LOG=1      log aggregated per-query token usage/cost to the
//                                   console (dev-only telemetry, opt-in — see isMain below)
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env['PORT'] ?? 8787);

// Same dependency-free .env loader as tools/agent.mjs and tools/pr-review-agent.mjs.
const loadEnv = () => {
  const envPath = resolve(REPO_ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    const value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
};

// ── Minimal HTTP boundary — no framework, no auth, no persistence (Phase 1 scope) ──
// Guarded so importing this module (e.g. from tests) only gets the pure pieces above —
// it does not load .env, require an API key, or start listening as a side effect.

const isMain = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  loadEnv();

  if (!process.env['ANTHROPIC_API_KEY']) {
    console.error('Set ANTHROPIC_API_KEY in your environment or in a .env file at the repo root.');
    process.exit(1);
  }

  const client = new Anthropic();

  const server = createServer((req, res) => {
    applyCors(req, res, process.env['BUSINESS_AGENT_ALLOWED_ORIGINS'], 'POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'POST' || req.url !== '/api/business-agent') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found', message: 'POST /api/business-agent only' }));
      return;
    }

    void (async () => {
      try {
        if (!isJsonContentType(req.headers['content-type'])) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_request', message: 'Content-Type must be application/json.' }));
          return;
        }

        const rawBody = await readRequestBody(req, MAX_BODY_BYTES);
        const { prompt, history } = parseAgentRequestBody(rawBody);
        console.log(`\n→ prompt: "${prompt}"${history.length ? ` (+${history.length} history msgs)` : ''}`);
        const snapshot = await fetchOrdersSnapshot();
        const { usage, ...result } = await runAgent(client, prompt, snapshot, history);
        for (const call of result.trace) {
          console.log(`  ● ${call.name}(${JSON.stringify(call.input)})`);
        }
        console.log(`  ✓ answer (${result.turns} turn${result.turns === 1 ? '' : 's'}): ${result.answer}\n`);
        if (process.env['BUSINESS_AGENT_USAGE_LOG'] === '1') {
          console.log(formatUsageLog(usage, result.turns));
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error('  ✗ error:', err);
        const { status, body } = mapErrorToResponse(err);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      }
    })();
  });

  server.listen(PORT, () => {
    console.log(`Business agent listening on http://localhost:${PORT}`);
    console.log(`\ncurl -s localhost:${PORT}/api/business-agent -X POST \\
  -H 'content-type: application/json' \\
  -d '{"prompt":"Which users need attention based on recent high-value orders?"}' | jq\n`);
  });
}
