import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { pathToFileURL } from 'node:url';
import { addOrder, getOrders, getSnapshot } from './orders-store.mjs';
import { applyCors } from './cors.mjs';

const PORT = process.env['PORT'] ? Number(process.env['PORT']) : 3000;

// Local-demo-only artificial latency on GET /api/orders (never /api/orders-snapshot
// — no UX reason to slow down the Business Agent). Defaults to 0, which is what
// Railway's production deployment gets (railway.json's startCommand runs this file
// directly, bypassing package.json scripts entirely, so it never sets this var).
// The demo value is applied only in package.json's start:react script.
const ORDERS_API_DELAY_MS = (() => {
  const raw = Number(process.env['MOCK_ORDERS_API_DELAY_MS']);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
})();

const STATUSES = ['pending', 'processing', 'completed', 'cancelled'];
const randomStatus = () => STATUSES[Math.floor(Math.random() * STATUSES.length)];
const userIds = [1, 2, 3];

const randomIntInclusive = (min, max) => {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
};

const randomMoney = () => Number((Math.random() * 750 + 25).toFixed(2));

// ── Visitor-log classification (see DEMO_LOG_EXCLUDED_TOKEN in
// docs/business-agent.md) — purely a log-filtering aid, e.g. so the deploy
// owner can tell their own testing traffic apart from non-excluded clients
// (anything without a matching owner/test classification token) in Railway
// logs. This is NOT authentication or authorization: it never gates
// access, never alters order generation, and never changes behavior for any
// connection — see logConnectionEvent below, its only consumer. The token is
// never logged and never persisted anywhere server-side; it's read fresh off
// each connecting request and compared, then discarded. Previously based on
// the connecting IP (X-Real-IP) — replaced because the deploy owner's own
// public IP isn't stable across networks/VPNs, unlike a fixed owner/test
// classification token. ──

const DEMO_LOG_EXCLUDED_TOKEN = process.env['DEMO_LOG_EXCLUDED_TOKEN'] ?? '';

// Pure + exported so every edge case (server token unset, viewer token
// absent, mismatch, exact match, both empty) is directly testable without a
// real connection. Excluded only when BOTH sides are non-empty and match —
// an unset server token must never accidentally match an unset/empty viewer
// token.
export function isViewerTokenExcluded(viewerToken, serverToken) {
  return Boolean(serverToken) && Boolean(viewerToken) && viewerToken === serverToken;
}

// The WS upgrade request's URL is relative (e.g. "/orders?viewerToken=..."),
// so a placeholder base is required to parse it with the URL API — the base
// itself is discarded, only used to make relative-URL parsing valid. Pure +
// exported so query-string parsing (other params present, token absent
// entirely) is directly testable without a real socket.
export function extractViewerToken(request) {
  if (!request?.url) return null;
  try {
    return new URL(request.url, 'http://localhost').searchParams.get('viewerToken');
  } catch {
    return null;
  }
}

// Takes the already-computed isExcludedClient boolean, not the raw token —
// each connection classifies itself exactly once (see attachConnectionHandler)
// and this just reports that decision, never re-derives it.
function logConnectionEvent(message, activeClients, isExcludedClient) {
  console.log(JSON.stringify({ message, activeClients, isExcludedClient }));
}

// Computed once at startup from the canonical store's seed data, then kept current
// by reading getOrders() fresh on every allocation — safe across multiple
// concurrently-running per-connection timers writing into the same store.
const nextIdByUser = new Map(
  userIds.map((userId) => {
    const maxForUser = Math.max(0, ...getOrders().filter((o) => o.userId === userId).map((o) => o.id));
    return [userId, maxForUser + 1];
  })
);

const allocateNewId = (userId) => {
  let candidate = nextIdByUser.get(userId) ?? userId * 100 + 1;
  const existingIds = new Set(getOrders().map((o) => o.id));
  while (existingIds.has(candidate)) {
    candidate += 1;
  }
  nextIdByUser.set(userId, candidate + 1);
  return candidate;
};

// ── HTTP: canonical reads for both frontends (plain Order[]) and the Business
// Agent (one atomic orders+arrivals snapshot — see tools/orders-store.mjs). The
// WebSocketServer below attaches to this same server/port instead of creating
// its own implicit one, so one process/port serves both transports. ──

const server = createServer((req, res) => {
  applyCors(req, res, process.env['ORDERS_API_ALLOWED_ORIGINS']);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/api/orders') {
    const respond = () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(getOrders()));
    };
    if (ORDERS_API_DELAY_MS > 0) {
      setTimeout(respond, ORDERS_API_DELAY_MS);
    } else {
      respond();
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/api/orders-snapshot') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(getSnapshot()));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const wss = new WebSocketServer({ server, path: '/orders' });

// removedOrderIds is only ever included (non-empty) when this same insert
// caused the canonical store to evict retention-expired orders for this
// order's user — see tools/orders-store.mjs's addOrder(). Already-connected
// clients MUST remove those ids before/while upserting `payload`, or their
// local state silently exceeds MAX_ORDERS_PER_USER forever even though every
// fresh read (GET /api/orders, GET /api/orders-snapshot) stays correctly
// bounded.
const broadcast = (payload, removedOrderIds) => {
  const message = JSON.stringify({
    type: 'order-update',
    payload,
    ...(removedOrderIds.length > 0 ? { removedOrderIds } : {}),
  });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(message);
  }
};

// activeClients/activeExternalClients here are pure observability — read at
// log time from the same counters attachConnectionHandler maintains, never
// consulted anywhere in the actual generation/broadcast logic above/below.
// A reader filtering Railway logs for activeExternalClients > 0 sees exactly
// the order-generation activity that occurred while at least one client NOT
// classified with the owner/test token was connected — not proof any
// specific kind of visitor was watching, just that some other, unmarked
// client was.
const emit = (userId, total = randomMoney()) => {
  const id = allocateNewId(userId);
  const payload = { id, userId, total: Number(total.toFixed(2)), status: randomStatus() };
  const { evictedOrderIds } = addOrder(payload);
  console.log(
    JSON.stringify({
      message: 'WS emit order',
      orderId: payload.id,
      userId: payload.userId,
      total: payload.total,
      status: payload.status,
      activeClients: activeConnectionCount,
      activeExternalClients: activeExternalConnectionCount,
      ...(evictedOrderIds.length > 0 ? { evictedOrderId: evictedOrderIds[0] } : {}),
    })
  );
  broadcast(payload, evictedOrderIds);
};

// ── Server-level (process-level) synthetic order generation — exactly ONE
// recurring generator and ONE startup burst per Node process, regardless of
// how many WS clients connect. Previously both lived inside wss.on('connection',
// ...), so every connected client spawned its own independent timer chain,
// making the business-event generation rate scale with connection count
// instead of being an intrinsic property of the server — a client should
// observe business events, not cause more of them to exist. Module scope
// keeps that property: the timer chain itself is never created or destroyed
// by a connection, so 10 connected clients still see exactly the same single
// event stream as 1. What DOES depend on connection count (below) is whether
// a given tick emits anything at all. ──

// Emits (and only emits — no id allocation, no store mutation, no order log)
// while at least one WS client is actually connected. The recurring timer
// itself is unconditional and always reschedules, so generation resumes
// automatically the moment a client (re)connects — no separate "wake up the
// generator" path needed on the connection side.
const scheduleNextGeneratedOrder = () => {
  const delayMs = randomIntInclusive(5000, 15000);
  setTimeout(() => {
    if (wss.clients.size > 0) {
      emit(userIds[randomIntInclusive(0, userIds.length - 1)]);
    }
    scheduleNextGeneratedOrder();
  }, delayMs);
};

// Startup burst — three rapid orders for the same user, fired once per
// distinct viewing session (a session being one 0-connected-clients ->
// 1-connected-client transition, not one physical connection):
// - first order is swallowed by the learning tick (monitoring baseline)
// - second order total >= $500 → triggers the high-value warning toast
// - third order within the burst window → triggers the critical burst toast
//
// Still connection-TRIGGERED, unlike the unconditional recurring generator
// above: Railway's process starts long before any client connects, so
// firing at process start would finish before anyone could see it. But once
// triggered, the timers are module-scope — not owned by or cancelled with the
// triggering connection — so they keep running even if that connection closes
// immediately after (e.g. React StrictMode's dev double-connect, or a real
// visitor closing the tab right away).
//
// isBurstInFlight tracks "scheduled OR still running", not merely "any
// client currently connected" — and is deliberately only cleared when the
// burst's OWN last timer fires, never on a disconnect. scheduleStartupBurstOnce
// is only ever called on a 0->1 transition (see attachConnectionHandler), so
// gating purely on this flag is enough to guarantee a fresh burst needs BOTH
// "back to zero viewers" (structurally true at every call site) AND "the
// previous burst has fully completed" — without the latter, a client that
// disconnects before its burst finishes and is replaced by a new one within
// that same window would schedule a second, overlapping burst (6 interleaved
// orders instead of a clean 3).
let isBurstInFlight = false;

const scheduleStartupBurstOnce = () => {
  if (isBurstInFlight) return;
  isBurstInFlight = true;
  const burstUserId = userIds[0];
  setTimeout(() => emit(burstUserId), 500);
  setTimeout(() => emit(burstUserId, randomMoney() + 500), 1500);
  setTimeout(() => {
    emit(burstUserId);
    isBurstInFlight = false; // completed — the next 0 -> 1 transition may start a new one
  }, 2500);
};

// Deliberately counters this module owns and updates itself in the
// connection/close handlers below, rather than reading wss.clients.size at
// those call sites: wss.clients is populated by the ws library as part of
// its real WebSocket handshake (completeUpgrade), which unit tests that
// drive wss.emit('connection', ...) directly (bypassing a real handshake)
// never go through — these counters stay accurate under that test style, and
// activeConnectionCount is exactly equivalent to wss.clients.size for any
// real connection.
//
// activeExternalConnectionCount is the same idea, scoped to connections NOT
// classified as the owner/test browser (isExcludedClient === false) — purely
// so generated-order logs (see emit() above) can report "was a client not
// carrying the owner/test token connected when this order was generated",
// without this count ever feeding back into whether an order is generated
// at all.
let activeConnectionCount = 0;
let activeExternalConnectionCount = 0;

const attachConnectionHandler = () => {
  wss.on('connection', (socket, request) => {
    // Classified exactly once, at connection time, from the token this
    // socket connected with — never re-read or re-compared for the rest of
    // this socket's lifetime (including at disconnect below).
    const viewerToken = extractViewerToken(request);
    const isExcludedClient = isViewerTokenExcluded(viewerToken, DEMO_LOG_EXCLUDED_TOKEN);

    activeConnectionCount += 1;
    if (!isExcludedClient) activeExternalConnectionCount += 1;
    logConnectionEvent('WS client connected', activeConnectionCount, isExcludedClient);

    // A fresh viewing session (the count just went 0 -> 1) gets its own
    // demo burst; a second tab/client joining an already-active session
    // must not schedule a duplicate one.
    if (activeConnectionCount === 1) {
      scheduleStartupBurstOnce();
    }

    // Keep the Railway proxy from timing out idle client→server direction
    const pingInterval = setInterval(() => socket.ping(), 30_000);

    // Math.max(0, count - 1) alone only stops the counters from going
    // negative — it does NOT make a socket's own contribution idempotent: if
    // 'close' fired twice for the same socket, the second decrement would
    // still silently steal a count point that rightfully belongs to some
    // OTHER, still-connected socket. This guard ensures each socket
    // decrements both counters exactly once, mirroring the exactly-one
    // increment above — "one connection contributes +1 exactly once and -1
    // exactly once" holds regardless of how many times 'close' fires.
    let hasClosed = false;
    socket.on('close', () => {
      if (hasClosed) return;
      hasClosed = true;
      clearInterval(pingInterval);
      activeConnectionCount = Math.max(0, activeConnectionCount - 1);
      if (!isExcludedClient) activeExternalConnectionCount = Math.max(0, activeExternalConnectionCount - 1);
      logConnectionEvent('WS client disconnected', activeConnectionCount, isExcludedClient);
      // Deliberately no isBurstInFlight reset here — see the comment above
      // scheduleStartupBurstOnce. Disconnecting (even back to zero viewers)
      // must not, by itself, free up a new burst while one is still running.
    });
  });
};

// Guarded so importing this module (e.g. from tests) only gets the pure/
// testable pieces exported below — it does not start the recurring generator,
// register the connection handler, or bind a real port as a side effect.
// Same isMain pattern already used by tools/business-agent-server.ts.
const isMain = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  scheduleNextGeneratedOrder();
  attachConnectionHandler();
  server.listen(PORT, () => {
    console.log(`Mock WS running at ws://localhost:${PORT}/orders`);
    console.log(`Orders API at http://localhost:${PORT}/api/orders`);
  });
}

export { server, wss, emit, broadcast, scheduleNextGeneratedOrder, scheduleStartupBurstOnce, attachConnectionHandler };
