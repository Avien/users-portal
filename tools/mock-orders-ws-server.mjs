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

// ── Visitor-log classification (see DEMO_LOG_EXCLUDED_IPS in CLAUDE.md /
// docs) — purely a log-filtering aid, e.g. so the deploy owner can tell their
// own traffic apart from real visitors in Railway logs. It never gates
// access, never alters order generation, and never changes app behavior for
// any IP — see logConnectionEvent below, its only consumer. ──

// Pure + exported so every parsing edge case (unset/one/multiple/whitespace)
// is directly testable without touching module-level env-var timing.
export function parseExcludedIps(envValue) {
  if (!envValue) return [];
  return envValue
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
}

export function isIpExcluded(ip, excludedIps) {
  return excludedIps.includes(ip);
}

const EXCLUDED_IPS = parseExcludedIps(process.env['DEMO_LOG_EXCLUDED_IPS']);

// Railway terminates TLS/HTTP at its edge and forwards the real client
// address via X-Real-IP on the upgrade request. Pure + exported (takes the
// header bag + a raw fallback rather than a live `request`) so both the
// Railway path and the local-dev fallback are directly testable without a
// real socket.
export function extractClientIp(request) {
  const forwarded = request?.headers?.['x-real-ip'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.trim();
  // Local dev / anything not behind Railway's proxy — X-Real-IP won't exist,
  // so fall back to the raw socket address (e.g. '::1' for localhost).
  return request?.socket?.remoteAddress ?? 'unknown';
}

// clientIp is used ONLY to compute isExcludedClient here — it is deliberately
// not included in the logged line itself. The one declared purpose of
// capturing it (telling the deploy owner's own traffic apart from real
// visitors) is fully served by that boolean; persisting the raw IP in
// Railway's logs would be incidental PII with no operational use this demo
// actually needs.
function logConnectionEvent(message, activeClients, clientIp) {
  console.log(
    JSON.stringify({
      message,
      activeClients,
      isExcludedClient: isIpExcluded(clientIp, EXCLUDED_IPS),
    })
  );
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

const emit = (userId, total = randomMoney()) => {
  const id = allocateNewId(userId);
  const payload = { id, userId, total: Number(total.toFixed(2)), status: randomStatus() };
  const { evictedOrderIds } = addOrder(payload);
  console.log(
    `WS emit order id=${payload.id} userId=${payload.userId} total=${payload.total} status=${payload.status}` +
      (evictedOrderIds.length > 0 ? ` (evicted: ${evictedOrderIds.join(',')})` : '')
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
// above: Railway's process starts long before any real visitor connects, so
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

// Deliberately a counter this module owns and updates itself in the
// connection/close handlers below, rather than reading wss.clients.size at
// those two call sites: wss.clients is populated by the ws library as part
// of its real WebSocket handshake (completeUpgrade), which unit tests that
// drive wss.emit('connection', ...) directly (bypassing a real handshake)
// never go through — this counter stays accurate under that test style, and
// is exactly equivalent to wss.clients.size for any real connection.
let activeConnectionCount = 0;

const attachConnectionHandler = () => {
  wss.on('connection', (socket, request) => {
    activeConnectionCount += 1;
    const clientIp = extractClientIp(request);
    logConnectionEvent('WS client connected', activeConnectionCount, clientIp);

    // A fresh viewing session (the count just went 0 -> 1) gets its own
    // demo burst; a second tab/client joining an already-active session
    // must not schedule a duplicate one.
    if (activeConnectionCount === 1) {
      scheduleStartupBurstOnce();
    }

    // Keep the Railway proxy from timing out idle client→server direction
    const pingInterval = setInterval(() => socket.ping(), 30_000);

    socket.on('close', () => {
      clearInterval(pingInterval);
      activeConnectionCount = Math.max(0, activeConnectionCount - 1);
      logConnectionEvent('WS client disconnected', activeConnectionCount, clientIp);
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
