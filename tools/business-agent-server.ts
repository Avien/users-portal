import Anthropic from '@anthropic-ai/sdk';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Order } from '../libs/users/src/index.ts';
import {
  MOCK_USERS,
  getOrdersByUserId,
  buildUserTotalOrdersVm,
  isSuspiciousHighValueOrder,
  isSecondOrderWithinBurstWindow,
  ORDER_BURST_WINDOW_MS,
  SUSPICIOUS_ORDER_TOTAL_THRESHOLD,
} from '../libs/users/src/index.ts';
import { applyCors } from './cors.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 of the Product-Facing Business AI Agent (see docs/roadmap.md).
// A minimal HTTP server exposing POST /api/business-agent — same hand-rolled
// Claude tool-use loop shape as tools/agent.mjs, but with a small set of
// READ-ONLY business tools over the existing Users/Orders domain instead of
// the dev-facing scaffold/edit/validate tools. No UI, no streaming to the
// caller, no persistence — this only proves the agent loop can answer a real
// multi-tool business question end to end.
//
// The server itself stays stateless between requests — the widget supplies a
// short, bounded conversation history on each call (see ConversationMessage /
// sanitizeHistory below) purely so Claude can resolve references like "his" or
// "she" across turns. Every request still fetches a fresh canonical snapshot
// (below), so a follow-up question always reasons over current business state,
// never a frozen answer from an earlier turn in the conversation.
//
// Orders are read from the canonical store (tools/orders-store.mjs, served by
// tools/mock-orders-ws-server.mjs) as one atomic snapshot per incoming request
// — not a static import — so the agent sees the same current business state as
// every frontend, including orders that arrived after this process started.
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

// Local-dev fallback only — production must set ORDERS_API_URL explicitly to a
// real deployed backend's snapshot endpoint (see docs/roadmap.md Phase 4).
const DEFAULT_ORDERS_SNAPSHOT_URL = 'http://localhost:3000/api/orders-snapshot';
const ORDERS_SNAPSHOT_URL = process.env['ORDERS_API_URL'] || DEFAULT_ORDERS_SNAPSHOT_URL;

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

// ── Canonical orders snapshot — one atomic read (orders + arrival metadata
// together) per incoming HTTP request, fetched once and threaded through the
// whole tool-use loop. Deliberately NOT two separate fetches (GET /api/orders
// then a second call for arrivals): an order could arrive between them. Retries
// briefly to absorb the `concurrently` startup race with tools/mock-orders-ws-
// server.mjs, then fails loudly — no silent fallback to stale static data,
// since that would let the agent give confident answers about data it can no
// longer prove is current. ──

export interface OrdersSnapshot {
  orders: Order[];
  arrivals: Record<number, number>;
}

// ── Multi-turn conversation context — short-lived, client-supplied, never persisted.
// The widget (libs/business-agent-widget) owns and bounds this to 6 messages on its
// side; sanitizeHistory() re-validates and re-bounds it here too, strictly (discards
// invalid entries rather than coercing them), since a request body is untrusted input
// regardless of what a well-behaved client sends. ──

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_HISTORY_MESSAGES = 6;
// Generous for a verbose business answer (the longest real answers seen so far are a
// few hundred characters), but bounded so a client can't inflate the Claude request
// with implausibly large content. Entries over the cap are discarded outright, not
// truncated — a truncated mid-sentence fragment could confuse Claude more than a
// dropped turn, and truncation would also be a form of coercion this sanitizer is
// deliberately avoiding elsewhere.
const MAX_HISTORY_MESSAGE_LENGTH = 2000;

function isConversationMessage(value: unknown): value is ConversationMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ConversationMessage>;
  return (
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string' &&
    candidate.content.length > 0 &&
    candidate.content.length <= MAX_HISTORY_MESSAGE_LENGTH
  );
}

export function sanitizeHistory(value: unknown): ConversationMessage[] {
  if (!Array.isArray(value)) return [];
  const valid = value.filter(isConversationMessage);
  return valid.slice(-MAX_HISTORY_MESSAGES);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchOrdersSnapshot(): Promise<OrdersSnapshot> {
  const retryDelaysMs = [250, 500];
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    try {
      const res = await fetch(ORDERS_SNAPSHOT_URL);
      if (!res.ok) throw new Error(`Orders snapshot request failed (${res.status})`);
      return (await res.json()) as OrdersSnapshot;
    } catch (err) {
      lastError = err;
      if (attempt < retryDelaysMs.length) await sleep(retryDelaysMs[attempt]);
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Orders data source unavailable at ${ORDERS_SNAPSHOT_URL} — is "npm run mock:ws" running? (${reason})`
  );
}

// ── Read-only business tools — thin wrappers over existing @portal/users/utils logic ──
// No new domain logic: searchUsers/getUserOrders/getOrderMonitoringSignals only
// filter/summarize what the current orders snapshot and shared utils already provide.
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
    run: ({ query }: { query?: string }, _snapshot: OrdersSnapshot) => {
      const q = query?.trim().toLowerCase();
      const matches = q ? MOCK_USERS.filter((u) => u.name.toLowerCase().includes(q)) : MOCK_USERS;
      return { users: matches };
    },
  },

  getUserOrders: {
    definition: {
      name: 'getUserOrders',
      description:
        'Get every current order for one user (by numeric userId), plus a total-spend summary — ' +
        'reflects orders up to the moment this tool is called, not a fixed starting dataset. ' +
        'Use searchUsers first if you only know the user by name.',
      input_schema: {
        type: 'object' as const,
        properties: { userId: { type: 'number', description: 'Numeric user id, e.g. 3' } },
        required: ['userId'],
      },
    },
    run: ({ userId }: { userId: number }, snapshot: OrdersSnapshot) => {
      const user = MOCK_USERS.find((u) => u.id === userId) ?? null;
      const orders = getOrdersByUserId(snapshot.orders, userId);
      const summary = buildUserTotalOrdersVm(user, orders);
      if (!user) return { error: `No user with id ${userId}` };
      return { orders, summary };
    },
  },

  getOrderMonitoringSignals: {
    definition: {
      name: 'getOrderMonitoringSignals',
      description:
        `Flag which of a user's current orders are high-value (>= $${SUSPICIOUS_ORDER_TOTAL_THRESHOLD}) ` +
        'and whether they have received multiple orders within a short burst window — the same two ' +
        "signals the live UI's warning/critical monitoring toasts use. Use this to judge which users " +
        'need attention right now, including orders that arrived after this conversation started.',
      input_schema: {
        type: 'object' as const,
        properties: { userId: { type: 'number', description: 'Numeric user id, e.g. 3' } },
        required: ['userId'],
      },
    },
    run: ({ userId }: { userId: number }, snapshot: OrdersSnapshot) => {
      const user = MOCK_USERS.find((u) => u.id === userId) ?? null;
      if (!user) return { error: `No user with id ${userId}` };
      const orders = getOrdersByUserId(snapshot.orders, userId);
      const highValueOrders = orders.filter(isSuspiciousHighValueOrder);
      const arrivalTimestamps = orders
        .map((o) => snapshot.arrivals[o.id])
        .filter((t): t is number => typeof t === 'number');
      const recentBurst = isSecondOrderWithinBurstWindow(arrivalTimestamps, ORDER_BURST_WINDOW_MS, Date.now());
      return {
        userName: user.name,
        threshold: SUSPICIOUS_ORDER_TOTAL_THRESHOLD,
        highValueOrderCount: highValueOrders.length,
        highValueOrders,
        recentBurst,
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
// Anthropic client and the orders snapshot are both parameters (not module-level
// state) so tests can pass fakes instead of calling the real API or a real server. ──

export const dispatch = (block: Anthropic.ToolUseBlock, snapshot: OrdersSnapshot) => {
  const tool = tools[block.name as ToolName];
  if (!tool) {
    return { type: 'tool_result' as const, tool_use_id: block.id, content: `Unknown tool: ${block.name}`, is_error: true };
  }
  try {
    const result = tool.run(block.input as never, snapshot);
    return { type: 'tool_result' as const, tool_use_id: block.id, content: JSON.stringify(result) };
  } catch (err) {
    return { type: 'tool_result' as const, tool_use_id: block.id, content: `Tool error: ${(err as Error).message}`, is_error: true };
  }
};

export const runAgent = async (
  client: Pick<Anthropic, 'messages'>,
  prompt: string,
  snapshot: OrdersSnapshot,
  history: ConversationMessage[] = []
) => {
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m): Anthropic.MessageParam => ({ role: m.role, content: m.content })),
    { role: 'user', content: prompt },
  ];
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
      return dispatch(block, snapshot);
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
    applyCors(req, res, process.env['BUSINESS_AGENT_ALLOWED_ORIGINS'], 'POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'POST' || req.url !== '/api/business-agent') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'POST /api/business-agent only' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const { prompt, history } = JSON.parse(body || '{}');
        if (!prompt || typeof prompt !== 'string') {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: '"prompt" (string) is required in the JSON body' }));
          return;
        }
        const conversationHistory = sanitizeHistory(history);
        console.log(`\n→ prompt: "${prompt}"${conversationHistory.length ? ` (+${conversationHistory.length} history msgs)` : ''}`);
        const snapshot = await fetchOrdersSnapshot();
        const result = await runAgent(client, prompt, snapshot, conversationHistory);
        for (const call of result.trace) {
          console.log(`  ● ${call.name}(${JSON.stringify(call.input)})`);
        }
        console.log(`  ✓ answer (${result.turns} turn${result.turns === 1 ? '' : 's'}): ${result.answer}\n`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error(`  ✗ error: ${(err as Error).message}\n`);
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
