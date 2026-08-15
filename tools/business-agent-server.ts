import Anthropic from '@anthropic-ai/sdk';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  MOCK_USERS,
  MOCK_ORDERS,
  getOrdersByUserId,
  buildUserTotalOrdersVm,
  isSuspiciousHighValueOrder,
  SUSPICIOUS_ORDER_TOTAL_THRESHOLD,
} from '../libs/users/src/index.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 of the Product-Facing Business AI Agent (see docs/roadmap.md).
// A minimal HTTP server exposing POST /api/business-agent — same hand-rolled
// Claude tool-use loop shape as tools/agent.mjs, but with a small set of
// READ-ONLY business tools over the existing Users/Orders domain instead of
// the dev-facing scaffold/edit/validate tools. No UI, no streaming to the
// caller, no conversation history, no persistence — this only proves the
// agent loop can answer a real multi-tool business question end to end.
//
//   ANTHROPIC_API_KEY=... npm run business-agent
//   curl -s localhost:8787/api/business-agent -X POST \
//     -H 'content-type: application/json' \
//     -d '{"prompt":"Which users need attention based on recent high-value orders?"}'
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = 'claude-opus-4-8';
const MAX_TURNS = 8;
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

// ── Read-only business tools — thin wrappers over existing @portal/users/utils logic ──
// No new domain logic: searchUsers/getUserOrders/getOrderMonitoringSignals only
// filter/summarize what MOCK_USERS + MOCK_ORDERS and the shared utils already provide.
// Exported (and side-effect-free) so tests can call tools.<name>.run(...) directly.

export const tools = {
  searchUsers: {
    definition: {
      name: 'searchUsers',
      description:
        'Search users by name (case-insensitive substring match). Omit "query" to list all users. ' +
        'Use this first to discover which user IDs exist before calling the other tools.',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Substring to match against user names, e.g. "dana"' },
        },
      },
    },
    run: ({ query }: { query?: string }) => {
      const q = query?.trim().toLowerCase();
      const matches = q ? MOCK_USERS.filter((u) => u.name.toLowerCase().includes(q)) : MOCK_USERS;
      return { users: matches };
    },
  },

  getUserOrders: {
    definition: {
      name: 'getUserOrders',
      description:
        'Get every order for one user (by numeric userId), plus a total-spend summary. ' +
        'Use searchUsers first if you only know the user by name.',
      input_schema: {
        type: 'object' as const,
        properties: { userId: { type: 'number', description: 'Numeric user id, e.g. 3' } },
        required: ['userId'],
      },
    },
    run: ({ userId }: { userId: number }) => {
      const user = MOCK_USERS.find((u) => u.id === userId) ?? null;
      const orders = getOrdersByUserId(MOCK_ORDERS, userId);
      const summary = buildUserTotalOrdersVm(user, orders);
      if (!user) return { error: `No user with id ${userId}` };
      return { orders, summary };
    },
  },

  getOrderMonitoringSignals: {
    definition: {
      name: 'getOrderMonitoringSignals',
      description:
        `Flag which of a user's orders are high-value (>= $${SUSPICIOUS_ORDER_TOTAL_THRESHOLD}, the ` +
        'same threshold the live order-monitoring toasts use). Use this to judge which users need ' +
        'attention. Note: this static mock dataset has no order-arrival timestamps, so burst-arrival ' +
        'detection (available in the live WS stream) is out of scope here — only the high-value signal applies.',
      input_schema: {
        type: 'object' as const,
        properties: { userId: { type: 'number', description: 'Numeric user id, e.g. 3' } },
        required: ['userId'],
      },
    },
    run: ({ userId }: { userId: number }) => {
      const user = MOCK_USERS.find((u) => u.id === userId) ?? null;
      if (!user) return { error: `No user with id ${userId}` };
      const orders = getOrdersByUserId(MOCK_ORDERS, userId);
      const highValueOrders = orders.filter(isSuspiciousHighValueOrder);
      return {
        userName: user.name,
        threshold: SUSPICIOUS_ORDER_TOTAL_THRESHOLD,
        highValueOrderCount: highValueOrders.length,
        highValueOrders,
      };
    },
  },
};

export type ToolName = keyof typeof tools;

const SYSTEM_PROMPT = `You are a business-data assistant for the Users Portal application. You answer
natural-language questions about users and their orders by calling the read-only tools provided —
never guess or fabricate user names, order totals, or ids. Call searchUsers first when you don't
already know the relevant user id(s). When a question asks about "which users" or "who" in general
(not a single named user), call searchUsers with no query to enumerate everyone, then check each
one with the other tools before answering. Give a concise, business-oriented final answer — name the
specific users and figures that drove your conclusion, not a description of which tools you called.`;

// ── The agentic loop — same model → tool → result → model shape as tools/agent.mjs,
// minus the mutating-tool confirmation gate (every tool here is read-only). The
// Anthropic client is a parameter (not a module-level singleton) so tests can pass
// a fake one instead of calling the real API. ──

export const dispatch = (block: Anthropic.ToolUseBlock) => {
  const tool = tools[block.name as ToolName];
  if (!tool) {
    return { type: 'tool_result' as const, tool_use_id: block.id, content: `Unknown tool: ${block.name}`, is_error: true };
  }
  try {
    const result = tool.run(block.input as never);
    return { type: 'tool_result' as const, tool_use_id: block.id, content: JSON.stringify(result) };
  } catch (err) {
    return { type: 'tool_result' as const, tool_use_id: block.id, content: `Tool error: ${(err as Error).message}`, is_error: true };
  }
};

export const runAgent = async (client: Pick<Anthropic, 'messages'>, prompt: string) => {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];
  const toolDefs = Object.values(tools).map((t) => t.definition);
  const trace: { name: string; input: unknown }[] = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const message = await client.messages
      .stream({
        model: MODEL,
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        system: SYSTEM_PROMPT,
        tools: toolDefs,
        messages,
      })
      .finalMessage();

    messages.push({ role: 'assistant', content: message.content });

    if (message.stop_reason !== 'tool_use') {
      const answer = message.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { answer, trace, turns: turn + 1 };
    }

    const toolUses = message.content.filter((b) => b.type === 'tool_use');
    const results = toolUses.map((block) => {
      trace.push({ name: block.name, input: block.input });
      return dispatch(block);
    });
    messages.push({ role: 'user', content: results });
  }

  return { answer: '(hit MAX_TURNS without a final answer)', trace, turns: MAX_TURNS };
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
    if (req.method !== 'POST' || req.url !== '/api/business-agent') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'POST /api/business-agent only' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const { prompt } = JSON.parse(body || '{}');
        if (!prompt || typeof prompt !== 'string') {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: '"prompt" (string) is required in the JSON body' }));
          return;
        }
        const result = await runAgent(client, prompt);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`Business agent listening on http://localhost:${PORT}`);
    console.log(`\ncurl -s localhost:${PORT}/api/business-agent -X POST \\
  -H 'content-type: application/json' \\
  -d '{"prompt":"Which users need attention based on recent high-value orders?"}' | jq\n`);
  });
}