import Anthropic from '@anthropic-ai/sdk';
// Abort-aware sleep — rejects immediately when its signal fires instead of
// waiting out the full delay (see the retry backoff in fetchOrdersSnapshot).
import { setTimeout as sleep } from 'node:timers/promises';
// Deliberately NOT '@portal/users/utils': Vercel's per-function bundler for
// api/business-agent.ts builds this file in isolation and doesn't resolve
// tsconfig.base.json's Nx path aliases, so the alias only works locally. The
// extensionless relative path is also deliberate — an explicit .ts extension
// here survives untranspiled into Vercel's compiled output as a literal
// require(".../*.ts"), which Node can't resolve (a real deploy failure fixed
// earlier; see git history for api/business-agent.ts). This is a narrow,
// Vercel-bundling-specific exception to the shared-contract import rule, not
// a pattern to copy elsewhere in the repo.
import type { Order } from '../libs/users/src/index';
import {
  MOCK_USERS,
  getOrdersByUserId,
  buildUserTotalOrdersVm,
  isSuspiciousHighValueOrder,
  isSecondOrderWithinBurstWindow,
  ORDER_BURST_WINDOW_MS,
  SUSPICIOUS_ORDER_TOTAL_THRESHOLD,
} from '../libs/users/src/index';

// ─────────────────────────────────────────────────────────────────────────────
// Product-Facing Business AI Agent — pure, transport-agnostic core (see
// docs/roadmap.md). No node:http, no Vercel types, no CORS, no env-file loading,
// no process bootstrap — this is the shared logic both the local dev server
// (tools/business-agent-server.ts) and the production serverless handler
// (api/business-agent.ts) import and call identically. Phase 4 split this out of
// what used to be one file mixing pure logic with the local dev HTTP adapter.
//
// This file's own relative imports are deliberately EXTENSIONLESS (unlike most
// of tools/*.ts) because it is bundled by Vercel's builder as part of
// api/business-agent.ts's dependency graph, in addition to being run directly
// via `tsx` for local dev — see the comment in api/business-agent.ts for the
// full explanation (a real Preview deployment failure, not a style choice).
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = 'claude-sonnet-5';
export const MAX_TURNS = 8;

// Right-sized for this agent's actual responses, not the SDK default. Tool-use
// turns need well under 200 tokens (just the function-call JSON); the longest
// real final-answer output observed in live testing was 697 output tokens for a
// detailed multi-user report. 2048 leaves ~3x headroom over that — including
// room for adaptive thinking, which draws from the same budget — while roughly
// halving the worst-case per-call token spend vs. the original 4096.
export const MAX_OUTPUT_TOKENS = 2048;

// One shared deadline for the WHOLE agent run (every turn of the tool-use loop),
// not per-call — bounds total wall-clock/cost exposure of one Ask regardless of
// how many of the MAX_TURNS turns it takes. Passed as an AbortSignal, the
// mechanism @anthropic-ai/sdk's `.stream()` actually supports via RequestOptions.
export const AGENT_TIMEOUT_MS = 45_000;

// The SDK retries 408/409/429/5xx + connection errors internally, independent of
// (and invisible to) our own MAX_TURNS/usage.apiCalls accounting — a single
// logical turn that hits one transient retry is still one turn to us, but is 2
// real HTTP attempts to Anthropic underneath. Kept low and explicit rather than
// the SDK default (2): one bounded retry is enough to ride out a single dropped
// connection or a brief 529 overload without letting the retry loop become an
// invisible, uncounted source of latency against AGENT_TIMEOUT_MS. The shared
// AbortSignal above still bounds retries too — a retry can never itself blow
// past the overall deadline.
export const SDK_MAX_RETRIES = 1;

// USD per million tokens, standard list price. Centralized and keyed by model so
// switching BUSINESS_AGENT_MODEL to an unpriced model fails loud (estimateCostUsd
// returns null) instead of silently mis-pricing.
const MODEL_PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 2.0, output: 10.0 },
  'claude-opus-4-8': { input: 5.0, output: 25.0 },
};

// Server-side only — no widget/env plumbing needed on the client side to change models.
// A function, not a frozen module-level constant: the dev adapter's .env loader only
// runs after its own module-level consts would already have been evaluated — so a
// frozen `const MODEL = process.env[...] || DEFAULT_MODEL` would permanently miss a
// BUSINESS_AGENT_MODEL supplied only via the repo's .env file (only an already-exported
// shell env var would have been visible in time). Reading process.env live on every call
// sidesteps that ordering entirely, and still lets already-exported shell vars win.
export function getConfiguredModel(): string {
  return process.env['BUSINESS_AGENT_MODEL'] || DEFAULT_MODEL;
}

// Local-dev fallback only — production must set ORDERS_API_URL explicitly to the
// real deployed Railway backend's snapshot endpoint.
const DEFAULT_ORDERS_SNAPSHOT_URL = 'http://localhost:3000/api/orders-snapshot';

// Same env-loading-order rationale as getConfiguredModel() above.
function getOrdersSnapshotUrl(): string {
  return process.env['ORDERS_API_URL'] || DEFAULT_ORDERS_SNAPSHOT_URL;
}

// ── Canonical orders snapshot — one atomic read (orders + arrival metadata
// together) per incoming HTTP request, fetched once and threaded through the
// whole tool-use loop. Deliberately NOT two separate fetches (GET /api/orders
// then a second call for arrivals): an order could arrive between them. Retries
// briefly to absorb a cold-start race with the orders backend, then fails loudly
// via OrdersSnapshotError — no silent fallback to stale static data, since that
// would let the agent give confident answers about data it can no longer prove
// is current. ──

// Bounds the WHOLE snapshot fetch — every attempt across the retry loop below,
// not per-attempt. Before this, a hung Railway request (connects but never
// responds) had no bound at all: the retry loop only retries on a THROWN
// error, and this call happens before runAgent()'s own AGENT_TIMEOUT_MS clock
// even starts — worst case, Vercel's maxDuration killed the function outright
// with no sanitized error response. Deliberately its own budget, not shared
// with AGENT_TIMEOUT_MS, so a slow upstream dependency can't eat into the
// agent loop's own time to think.
export const ORDERS_SNAPSHOT_FETCH_TIMEOUT_MS = 5_000;

export interface OrdersSnapshot {
  orders: Order[];
  arrivals: Record<number, number>;
}

// Shallow structural check, same style as isConversationMessage below and the
// widget's own isAgentResponse — not a schema library, just enough to stop a
// malformed backend response (wrong shape, a proxy/error page that still
// returned 200, a future breaking change to the snapshot endpoint) from
// flowing straight into the agent loop via an unchecked `as OrdersSnapshot`
// cast. Doesn't validate individual Order fields — that's a level of depth
// this lightweight check deliberately doesn't attempt.
function isOrdersSnapshot(value: unknown): value is OrdersSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<OrdersSnapshot>;
  return Array.isArray(candidate.orders) && typeof candidate.arrivals === 'object' && candidate.arrivals !== null;
}

// A distinguishable class (not a plain Error) so the HTTP boundary can map this
// specific failure to a sanitized "Orders backend unavailable" response without
// string-matching the message — the message itself still carries the real,
// dev-facing detail (e.g. "is mock:ws running?"), kept out of any HTTP response.
export class OrdersSnapshotError extends Error {}

// Thrown — never returned as a normal { answer, trace, turns } success value —
// when the tool-use loop exhausts MAX_TURNS without Claude producing a final
// answer. This is a genuine failure to complete the request, not a business
// answer; letting it through as a 200 with an answer field would have the
// widget render it, store it in history, and replay it back to Claude as if
// it were a real prior assistant turn on the next follow-up.
export class AgentMaxTurnsExceededError extends Error {}

export async function fetchOrdersSnapshot(): Promise<OrdersSnapshot> {
  const url = getOrdersSnapshotUrl();
  const retryDelaysMs = [250, 500];
  const controller = new AbortController();
  const deadlineId = setTimeout(() => controller.abort(), ORDERS_SNAPSHOT_FETCH_TIMEOUT_MS);
  let lastError: unknown;
  try {
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`Orders snapshot request failed (${res.status})`);
        const parsed: unknown = await res.json();
        if (!isOrdersSnapshot(parsed)) {
          throw new Error('Orders snapshot response has an unexpected shape.');
        }
        return parsed;
      } catch (err) {
        lastError = err;
        // Once the shared deadline has fired, every remaining attempt would
        // also reject near-instantly on the same aborted signal — stop
        // immediately instead of still sleeping out the retry backoff.
        if (controller.signal.aborted) break;
        if (attempt < retryDelaysMs.length) {
          try {
            // Abort-aware: if the deadline fires WHILE this sleep is in
            // progress, it rejects immediately instead of waiting out the
            // full 250/500ms — bounds the overrun to near-zero rather than
            // up to the sleep's own duration.
            await sleep(retryDelaysMs[attempt], undefined, { signal: controller.signal });
          } catch {
            break;
          }
        }
      }
    }
  } finally {
    clearTimeout(deadlineId);
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new OrdersSnapshotError(
    `Orders data source unavailable at ${url} — is "npm run mock:ws" running? (${reason})`
  );
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

// ── Request-body validation — the HTTP body is untrusted input regardless of
// transport (local dev node:http, or the production serverless handler), so this
// is transport-agnostic and shared by both. Throws RequestValidationError with a
// message that is always safe to return to the caller verbatim (it only ever
// describes what's wrong with THEIR request, never internal detail). ──

export class RequestValidationError extends Error {}

// Matches MAX_HISTORY_MESSAGE_LENGTH above — same convention, no separate number
// to justify. Comfortably fits any real business question.
export const MAX_PROMPT_LENGTH = 2000;

export interface AgentRequestPayload {
  prompt: string;
  history: ConversationMessage[];
}

export function parseAgentRequestBody(rawBody: string): AgentRequestPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody || '{}');
  } catch {
    throw new RequestValidationError('Request body must be valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new RequestValidationError('Request body must be a JSON object.');
  }
  const { prompt, history } = parsed as { prompt?: unknown; history?: unknown };
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new RequestValidationError('"prompt" (non-empty string) is required.');
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new RequestValidationError(`"prompt" exceeds the maximum length of ${MAX_PROMPT_LENGTH} characters.`);
  }
  return { prompt, history: sanitizeHistory(history) };
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
        'Get this user\'s CURRENTLY RETAINED orders (by numeric userId) plus a total-spend summary ' +
        'for that retained set — up to the most recent 30 orders; older ones have been evicted and ' +
        'are not included, so this is not a full lifetime order history. Reflects the canonical ' +
        'Orders snapshot captured at the start of this request, not a fixed starting dataset. Use ' +
        'searchUsers first if you only know the user by name.',
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
        `Flag which of a user's orders are high-value (>= $${SUSPICIOUS_ORDER_TOTAL_THRESHOLD}) and ` +
        'whether they have received multiple orders within a short burst window — the same two signals ' +
        "the live UI's warning/critical monitoring toasts use, evaluated against the canonical Orders " +
        'snapshot captured at the start of this request. Use this to judge which users need attention.',
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

// ── Per-user-query usage telemetry — one user question can drive multiple Anthropic
// Messages API calls via the tool-use loop below; this aggregates across all of them
// into one figure for the whole Ask action, never per-call. usage.apiCalls counts our
// own logical loop turns (one per finalMessage() result) — SDK-level retries (see
// SDK_MAX_RETRIES above) are a separate, lower-level concept and are NOT reflected
// here: a turn that required one retry underneath is still exactly one apiCalls
// increment, the same as a turn that succeeded on the first attempt. Dev-only,
// server-side only — never part of the public HTTP response (see the adapters). ──

export interface AgentUsage {
  model: string;
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
}

export function estimateCostUsd(usage: Pick<AgentUsage, 'model' | 'inputTokens' | 'outputTokens'>): number | null {
  const pricing = MODEL_PRICING_USD_PER_MTOK[usage.model];
  if (!pricing) return null;
  return (usage.inputTokens / 1_000_000) * pricing.input + (usage.outputTokens / 1_000_000) * pricing.output;
}

// Shared by both adapters so the log format never drifts between dev and prod.
export function formatUsageLog(usage: AgentUsage, turns: number): string {
  const costUsd = estimateCostUsd(usage);
  return (
    `[Business Agent Usage]\n` +
    `model: ${usage.model}\n` +
    `apiCalls: ${usage.apiCalls}\n` +
    `turns: ${turns}\n` +
    `inputTokens: ${usage.inputTokens}\n` +
    `outputTokens: ${usage.outputTokens}\n` +
    `estimatedCostUsd: ${costUsd === null ? 'unknown' : costUsd.toFixed(6)}\n`
  );
}

// Exported (not just module-private) so tests can assert on its exact content
// directly, in addition to asserting it's the `system` value actually sent to
// the Anthropic API (see business-agent-core.spec.ts's "data-scope semantics"
// tests) — the two together are what proves the prompt text and the wired-up
// behavior haven't drifted apart.
export const SYSTEM_PROMPT = `You are a business-data assistant for the Users Portal application. You answer
natural-language questions about users and their orders by calling the read-only tools provided —
never guess or fabricate user names, order totals, or ids. Call searchUsers first when you don't
already know the relevant user id(s). When a question asks about "which users" or "who" in general
(not a single named user), call searchUsers with no query to enumerate everyone, then check each
one with the other tools before answering. Give a concise, business-oriented final answer — name the
specific users and figures that drove your conclusion, not a description of which tools you called.

Data scope: every tool call within this single Ask reads the SAME current canonical Orders snapshot,
captured once right before this request began — it does not update mid-request, and a new Ask
(including a follow-up later in this same conversation) takes its own fresh snapshot. That snapshot
is NOT a lifetime-complete dataset: the backend retains only the most recent 30 orders per user
(oldest evicted first as new ones arrive). Older orders are evicted from the retained dataset and
are unavailable to the agent/tools; there is no historical archive available to this application —
no tool, and no other data source, can retrieve them once evicted. If a question implies full lifetime history
("first order ever", "all historical orders", "lifetime spend", "total orders of all time," etc.),
do NOT answer as if the current retained orders were the complete history. Say plainly that the
available data only covers the current retained window (up to 30 recent orders per user), not a
full historical record, and answer only for what that window actually shows.`;

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

export interface RunAgentOptions {
  // Overridable for tests (a short-fused signal to exercise the timeout path
  // quickly); defaults to a real AGENT_TIMEOUT_MS deadline shared across every
  // turn of this run.
  signal?: AbortSignal;
}

export const runAgent = async (
  client: Pick<Anthropic, 'messages'>,
  prompt: string,
  snapshot: OrdersSnapshot,
  history: ConversationMessage[] = [],
  options: RunAgentOptions = {}
) => {
  const signal = options.signal ?? AbortSignal.timeout(AGENT_TIMEOUT_MS);
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m): Anthropic.MessageParam => ({ role: m.role, content: m.content })),
    { role: 'user', content: prompt },
  ];
  const toolDefs = Object.values(tools).map((t) => t.definition);
  const trace: { name: string; input: unknown }[] = [];

  // Resolved once per run, not re-read per turn — every call in this run's tool-use
  // loop must use the same model a client could have overridden mid-run otherwise.
  const model = getConfiguredModel();

  // One user question can drive several Anthropic calls below (one per turn of the
  // tool-use loop) — accumulated here into a single usage figure for the whole run,
  // never reported per-call. Seeded with the model this run was configured to use;
  // each turn below then overwrites it with the actual serving model from that
  // response (identical today — no fallback/retry-on-different-model logic exists —
  // but reading it from the response is the more correct source of truth).
  const usage: AgentUsage = { model, apiCalls: 0, inputTokens: 0, outputTokens: 0 };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const message = await client.messages
      .stream(
        {
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          thinking: { type: 'adaptive' },
          system: SYSTEM_PROMPT,
          tools: toolDefs,
          messages,
        },
        { signal, maxRetries: SDK_MAX_RETRIES }
      )
      .finalMessage();

    usage.apiCalls += 1;
    usage.inputTokens += message.usage.input_tokens;
    usage.outputTokens += message.usage.output_tokens;
    usage.model = message.model;

    messages.push({ role: 'assistant', content: message.content });

    if (message.stop_reason !== 'tool_use') {
      const answer = message.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { answer, trace, turns: turn + 1, usage };
    }

    const toolUses = message.content.filter((b) => b.type === 'tool_use');
    const results = toolUses.map((block) => {
      trace.push({ name: block.name, input: block.input });
      return dispatch(block, snapshot);
    });
    messages.push({ role: 'user', content: results });
  }

  throw new AgentMaxTurnsExceededError(
    `Agent did not produce a final answer within MAX_TURNS=${MAX_TURNS} turns.`
  );
};
