import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
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

// Fires once per server process, not once per connection — with shared canonical
// state, a second tab connecting would otherwise replay a burst the first tab
// already saw.
let hasFiredStartupBurst = false;

wss.on('connection', (socket) => {
  console.log('Client connected to mock orders socket');

  const broadcast = (payload) => {
    const message = JSON.stringify({ type: 'order-update', payload });
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(message);
    }
  };

  const emit = (userId, total = randomMoney()) => {
    const id = allocateNewId(userId);
    const payload = { id, userId, total: Number(total.toFixed(2)), status: randomStatus() };
    addOrder(payload);
    console.log(`WS emit order id=${payload.id} userId=${payload.userId} total=${payload.total} status=${payload.status}`);
    broadcast(payload);
  };

  // Three rapid orders for the same user on the first-ever connection:
  // - first order is swallowed by the learning tick (monitoring baseline)
  // - second order total >= $500 → triggers the high-value warning toast
  // - third order within the burst window → triggers the critical burst toast
  //
  // hasFiredStartupBurst is only set once the first timer actually FIRES, not
  // when it's scheduled — React StrictMode's dev-mode mount→unmount→remount
  // cycle means the first connection is often ephemeral and closes (cancelling
  // its timers via the socket 'close' handler below) before 500ms elapses. If
  // the flag were set at scheduling time, that ephemeral connection would
  // "use up" the demo burst without ever actually emitting it, leaving the
  // real persisting connection with none.
  let burstTimer1;
  let burstTimer2;
  let burstTimer3;
  if (!hasFiredStartupBurst) {
    const burstUserId = userIds[0];
    burstTimer1 = setTimeout(() => {
      hasFiredStartupBurst = true;
      emit(burstUserId);
    }, 500);
    burstTimer2 = setTimeout(() => emit(burstUserId, randomMoney() + 500), 1500);
    burstTimer3 = setTimeout(() => emit(burstUserId), 2500);
  }

  const scheduleNext = () => {
    const delayMs = randomIntInclusive(5000, 15000);
    return setTimeout(() => {
      emit(userIds[randomIntInclusive(0, userIds.length - 1)]);
      timer = scheduleNext();
    }, delayMs);
  };

  let timer = scheduleNext();

  // Keep the Railway proxy from timing out idle client→server direction
  const pingInterval = setInterval(() => socket.ping(), 30_000);

  socket.on('close', () => {
    clearInterval(pingInterval);
    clearTimeout(burstTimer1);
    clearTimeout(burstTimer2);
    clearTimeout(burstTimer3);
    clearTimeout(timer);
    console.log('Client disconnected from mock orders socket');
  });
});

server.listen(PORT, () => {
  console.log(`Mock WS running at ws://localhost:${PORT}/orders`);
  console.log(`Orders API at http://localhost:${PORT}/api/orders`);
});
