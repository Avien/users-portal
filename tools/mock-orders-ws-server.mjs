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
// fixes that: broadcast() over zero clients is a no-op, so the generator runs
// identically regardless of connection count, and a disconnect can't affect
// it since it was never tied to any connection's lifecycle. ──

const scheduleNextGeneratedOrder = () => {
  const delayMs = randomIntInclusive(5000, 15000);
  setTimeout(() => {
    emit(userIds[randomIntInclusive(0, userIds.length - 1)]);
    scheduleNextGeneratedOrder();
  }, delayMs);
};

// Startup burst — three rapid orders for the same user, fired at most once per
// process, the first time a WS client connects:
// - first order is swallowed by the learning tick (monitoring baseline)
// - second order total >= $500 → triggers the high-value warning toast
// - third order within the burst window → triggers the critical burst toast
//
// Still connection-TRIGGERED, unlike the unconditional recurring generator
// above: Railway's process starts long before any real visitor connects, so
// firing at process start would finish before anyone could see it. But once
// triggered, the timers are module-scope — not owned by or cancelled with the
// triggering connection — so they keep running even if that connection closes
// immediately after (e.g. React StrictMode's dev double-connect).
//
// The flag is set at SCHEDULE time, not fire time, so two connections
// arriving in the same tick can't both see "not yet scheduled" and each
// schedule their own copy of the burst.
let hasScheduledStartupBurst = false;

const scheduleStartupBurstOnce = () => {
  if (hasScheduledStartupBurst) return;
  hasScheduledStartupBurst = true;
  const burstUserId = userIds[0];
  setTimeout(() => emit(burstUserId), 500);
  setTimeout(() => emit(burstUserId, randomMoney() + 500), 1500);
  setTimeout(() => emit(burstUserId), 2500);
};

const attachConnectionHandler = () => {
  wss.on('connection', (socket) => {
    console.log('Client connected to mock orders socket');

    scheduleStartupBurstOnce();

    // Keep the Railway proxy from timing out idle client→server direction
    const pingInterval = setInterval(() => socket.ping(), 30_000);

    socket.on('close', () => {
      clearInterval(pingInterval);
      console.log('Client disconnected from mock orders socket');
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
