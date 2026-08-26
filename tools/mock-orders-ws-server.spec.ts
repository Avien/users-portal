import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

// Fresh module instance per test (vi.resetModules + dynamic import) — this
// module holds process-level singleton state (hasScheduledStartupBurst) by
// design (that IS the fix for IMPORTANT #1), so tests need genuine isolation
// from each other rather than sharing one imported instance across the file.
// Importing never starts the real generator/listener/server as a side effect
// (see the isMain guard in the module) — tests invoke the exported pieces
// explicitly under controlled conditions instead.
async function loadFreshModule() {
  vi.resetModules();
  return import('./mock-orders-ws-server.mjs');
}

function makeFakeSocket() {
  const socket = new EventEmitter();
  // @ts-expect-error - test double, only needs to satisfy what the connection handler calls
  socket.ping = () => {};
  return socket;
}

function makeFakeRequest(headers: Record<string, string> = {}, remoteAddress = '127.0.0.1') {
  return { headers, socket: { remoteAddress } };
}

// A placeholder occupying a `wss.clients` slot for the recurring generator's
// `wss.clients.size` check — broadcast() also iterates wss.clients and calls
// .send() on anything reporting readyState === OPEN, so this needs to look
// "open" and no-op sendable, not just be present.
function makeFakeWsClient() {
  return { readyState: 1, OPEN: 1, send: () => {} };
}

// Timer-scheduling behavior only — no real WS/HTTP I/O in this block, so fake
// timers are safe (and required) here. Without them, scheduleStartupBurstOnce's
// 500/1500/2500ms timers and — worse — scheduleNextGeneratedOrder's real
// 5-15s timer (whose own callback recursively reschedules itself) would be
// genuinely live Node timers that outlive the test, firing/rescheduling in the
// background and leaking handles. vi.clearAllTimers() in afterEach (while
// still faked) discards every pending one, including any recursive chain link,
// before vi.useRealTimers() hands control back to the real clock — production
// scheduling itself (delays, recursion, the guard flag) is untouched, only the
// clock these tests observe it through is fake.
describe('mock-orders-ws-server — process-level synthetic order generation (timer scheduling)', () => {
  let mod: Awaited<ReturnType<typeof loadFreshModule>>;

  beforeEach(async () => {
    vi.useFakeTimers();
    mod = await loadFreshModule();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
    mod.server.close();
  });

  it('the startup burst schedules its 3 timers exactly once, no matter how many times it is triggered', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    // Simulates 3 clients connecting in quick succession, each of which would
    // previously have raced to schedule its own copy of the burst.
    mod.scheduleStartupBurstOnce();
    mod.scheduleStartupBurstOnce();
    mod.scheduleStartupBurstOnce();
    expect(setTimeoutSpy).toHaveBeenCalledTimes(3);
  });

  it('a second client joining while the first is still connected does not schedule a second burst', () => {
    mod.attachConnectionHandler();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const clientA = makeFakeSocket();
    mod.wss.emit('connection', clientA, makeFakeRequest());
    expect(setTimeoutSpy).toHaveBeenCalledTimes(3);

    // clientA is still connected (0 -> 1 -> 2, never back to 0) — clientB
    // joining an already-active session must not schedule a duplicate burst.
    const clientB = makeFakeSocket();
    mod.wss.emit('connection', clientB, makeFakeRequest());
    expect(setTimeoutSpy).toHaveBeenCalledTimes(3);

    clientA.emit('close');
    clientB.emit('close');
  });

  it('after the previous burst fully completes and active count returns to 0, the next connection starts a fresh burst', () => {
    mod.attachConnectionHandler();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const clientA = makeFakeSocket();
    mod.wss.emit('connection', clientA, makeFakeRequest());
    expect(setTimeoutSpy).toHaveBeenCalledTimes(3);

    clientA.emit('close'); // active count returns to 0 — session genuinely ends
    vi.advanceTimersByTime(2500); // clientA's burst runs all the way to completion

    const clientB = makeFakeSocket();
    mod.wss.emit('connection', clientB, makeFakeRequest()); // a new 0 -> 1 transition
    expect(setTimeoutSpy).toHaveBeenCalledTimes(6); // a fresh, second burst was scheduled

    clientB.emit('close');
  });

  it('connect A -> disconnect immediately -> connect B before 2.5s -> only one 3-order burst total (no overlap)', async () => {
    // Same module epoch as `mod` — reads the exact canonical store singleton
    // mod's emit() writes into.
    const { getOrders } = await import('./orders-store.mjs');
    mod.attachConnectionHandler();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const clientA = makeFakeSocket();
    mod.wss.emit('connection', clientA, makeFakeRequest());
    clientA.emit('close'); // gone well before its burst's 2500ms timer fires

    const clientB = makeFakeSocket();
    mod.wss.emit('connection', clientB, makeFakeRequest()); // connects while A's burst is still in flight
    // Still only the ONE burst's 3 timers — B's connection did not schedule
    // a second, overlapping burst.
    expect(setTimeoutSpy).toHaveBeenCalledTimes(3);

    const before = getOrders().length;
    vi.advanceTimersByTime(2500);
    expect(getOrders().length).toBe(before + 3); // exactly 3 orders total, not 6

    clientB.emit('close');
  });

  it('a client disconnecting immediately does not cancel its already-scheduled burst timers', async () => {
    // Same module epoch as `mod` (no intervening vi.resetModules()) — reads
    // the exact canonical store singleton mod's emit() writes into.
    const { getOrders } = await import('./orders-store.mjs');
    mod.attachConnectionHandler();

    const clientA = makeFakeSocket();
    mod.wss.emit('connection', clientA, makeFakeRequest());
    clientA.emit('close'); // gone before any of the 500/1500/2500ms timers fire

    const before = getOrders().length;
    vi.advanceTimersByTime(2500);
    // All 3 burst orders still landed in the store — the timers are
    // module-scope, never owned by (or cancelled with) the connection.
    expect(getOrders().length).toBe(before + 3);
  });

  it('connecting does not create a per-connection recurring-generator timer chain', () => {
    mod.attachConnectionHandler();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const clientA = makeFakeSocket();
    const clientB = makeFakeSocket();
    const clientC = makeFakeSocket();
    mod.wss.emit('connection', clientA);
    mod.wss.emit('connection', clientB);
    mod.wss.emit('connection', clientC);

    // The only setTimeout calls attributable to connecting are the burst's 3 —
    // scheduled once regardless of how many clients connected. The recurring
    // generator itself is started by scheduleNextGeneratedOrder(), which is
    // never called from the connection handler at all (see production isMain
    // block) — there is no per-connection code path left that could create it.
    expect(setTimeoutSpy).toHaveBeenCalledTimes(3);

    clientA.emit('close');
    clientB.emit('close');
    clientC.emit('close');
  });

  it('scheduleNextGeneratedOrder schedules exactly one timer per call — calling it once produces one generator chain link', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    mod.scheduleNextGeneratedOrder();
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    // The chain link itself must not have already recursed within this test —
    // fake timers never auto-advance, so this also proves no real timer fired.
    expect(vi.getTimerCount()).toBe(1);
  });
});

// wss.clients is a real Set the `ws` library normally populates during its own
// handshake (completeUpgrade) — these tests add/remove plain placeholder
// objects directly, which is enough to exercise the exact `wss.clients.size`
// check the generator's tick uses, without a real WebSocket connection.
describe('mock-orders-ws-server — recurring generator only emits while clients are connected', () => {
  let mod: Awaited<ReturnType<typeof loadFreshModule>>;
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    mod = await loadFreshModule();
    // Pins scheduleNextGeneratedOrder's delay (and emit's own random total/
    // status/user-index picks) to a single deterministic value, so exactly
    // one tick fires per 5000ms advance instead of an unpredictable number.
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    randomSpy.mockRestore();
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
    mod.server.close();
  });

  it('zero connected clients: a tick does not emit an order, allocate an id, or mutate the store', async () => {
    const { getOrders } = await import('./orders-store.mjs');
    expect(mod.wss.clients.size).toBe(0);

    const before = getOrders().length;
    mod.scheduleNextGeneratedOrder();
    vi.advanceTimersByTime(5000);

    expect(getOrders().length).toBe(before);
  });

  it('one connected client: a tick emits exactly one order', async () => {
    const { getOrders } = await import('./orders-store.mjs');
    mod.wss.clients.add(makeFakeWsClient() as never);

    const before = getOrders().length;
    mod.scheduleNextGeneratedOrder();
    vi.advanceTimersByTime(5000);

    expect(getOrders().length).toBe(before + 1);
  });

  it('multiple connected clients: a tick still emits exactly one order, not one per client', async () => {
    const { getOrders } = await import('./orders-store.mjs');
    mod.wss.clients.add(makeFakeWsClient() as never);
    mod.wss.clients.add(makeFakeWsClient() as never);
    mod.wss.clients.add(makeFakeWsClient() as never);
    expect(mod.wss.clients.size).toBe(3);

    const before = getOrders().length;
    mod.scheduleNextGeneratedOrder();
    vi.advanceTimersByTime(5000);

    expect(getOrders().length).toBe(before + 1);
  });

  it('generation resumes automatically once a client reconnects after a zero-client tick', async () => {
    const { getOrders } = await import('./orders-store.mjs');
    const before = getOrders().length;

    mod.scheduleNextGeneratedOrder();
    vi.advanceTimersByTime(5000); // zero clients — no-op tick
    expect(getOrders().length).toBe(before);

    mod.wss.clients.add(makeFakeWsClient() as never);
    vi.advanceTimersByTime(5000); // same recurring chain, now with a client
    expect(getOrders().length).toBe(before + 1);
  });

  it('repeated connect/disconnect cycles never multiply the generator rate — still one order per tick', async () => {
    const { getOrders } = await import('./orders-store.mjs');
    mod.attachConnectionHandler();

    // Five separate connect/disconnect cycles (each its own 0 -> 1 -> 0
    // session) before the generator ever ticks. If connecting spawned its
    // own generator timer chain (the bug this design prevents), this would
    // leave 5 independent chains all ticking at once.
    for (let i = 0; i < 5; i++) {
      const client = makeFakeSocket();
      mod.wss.emit('connection', client, makeFakeRequest());
      client.emit('close');
    }
    // Let all 5 bursts' timers (500/1500/2500ms each) fully settle before
    // measuring the generator's own tick rate in isolation below.
    vi.advanceTimersByTime(2500);

    mod.wss.clients.add(makeFakeWsClient() as never); // one real client connected for the generator ticks below
    mod.scheduleNextGeneratedOrder();

    const before = getOrders().length;
    vi.advanceTimersByTime(5000); // one tick
    vi.advanceTimersByTime(5000); // a second tick
    vi.advanceTimersByTime(5000); // a third tick

    // Exactly 3 new orders (one per tick) — not 15 (5 phantom per-connection
    // chains x 3 ticks), proving there is still only the single process-level
    // generator chain.
    expect(getOrders().length).toBe(before + 3);
  });
});

describe('mock-orders-ws-server — structured connection lifecycle logging', () => {
  let mod: Awaited<ReturnType<typeof loadFreshModule>>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    mod = await loadFreshModule();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
    mod.server.close();
  });

  function lastLoggedJson(): Record<string, unknown> {
    const lastCall = logSpy.mock.calls.at(-1);
    return JSON.parse(lastCall?.[0] as string);
  }

  it('logs a structured connect event with the active client count and exclusion flag, never the raw IP', () => {
    mod.attachConnectionHandler();
    const clientA = makeFakeSocket();
    mod.wss.emit('connection', clientA, makeFakeRequest({ 'x-real-ip': '203.0.113.5' }));

    expect(lastLoggedJson()).toEqual({
      message: 'WS client connected',
      activeClients: 1,
      isExcludedClient: false,
    });

    clientA.emit('close');
  });

  it('logs the updated active count on disconnect', () => {
    mod.attachConnectionHandler();
    const clientA = makeFakeSocket();
    const clientB = makeFakeSocket();
    mod.wss.emit('connection', clientA, makeFakeRequest({ 'x-real-ip': '203.0.113.5' }));
    mod.wss.emit('connection', clientB, makeFakeRequest({ 'x-real-ip': '203.0.113.6' }));

    clientA.emit('close');
    expect(lastLoggedJson()).toEqual({
      message: 'WS client disconnected',
      activeClients: 1,
      isExcludedClient: false,
    });

    clientB.emit('close');
    expect(lastLoggedJson()).toMatchObject({ message: 'WS client disconnected', activeClients: 0 });
  });

  it('never includes a clientIp key in the logged line, with or without X-Real-IP present', () => {
    mod.attachConnectionHandler();

    const clientA = makeFakeSocket();
    mod.wss.emit('connection', clientA, makeFakeRequest({ 'x-real-ip': '203.0.113.5' }));
    expect(lastLoggedJson()).not.toHaveProperty('clientIp');
    clientA.emit('close');

    const clientB = makeFakeSocket();
    mod.wss.emit('connection', clientB, makeFakeRequest({}, '127.0.0.1')); // local fallback path
    expect(lastLoggedJson()).not.toHaveProperty('clientIp');
    clientB.emit('close');
  });
});

describe('mock-orders-ws-server — DEMO_LOG_EXCLUDED_IPS (log classification only)', () => {
  let mod: Awaited<ReturnType<typeof loadFreshModule>>;

  beforeEach(async () => {
    mod = await loadFreshModule();
  });

  afterEach(() => {
    mod.server.close();
  });

  it('parses an unset value as no exclusions', () => {
    expect(mod.parseExcludedIps(undefined)).toEqual([]);
    expect(mod.parseExcludedIps('')).toEqual([]);
  });

  it('parses a single IP', () => {
    expect(mod.parseExcludedIps('203.0.113.5')).toEqual(['203.0.113.5']);
  });

  it('parses multiple comma-separated IPs, trimming whitespace', () => {
    expect(mod.parseExcludedIps(' 203.0.113.5 , 203.0.113.6,203.0.113.7 ')).toEqual([
      '203.0.113.5',
      '203.0.113.6',
      '203.0.113.7',
    ]);
  });

  it('drops empty entries from stray commas', () => {
    expect(mod.parseExcludedIps('203.0.113.5,,203.0.113.6,')).toEqual(['203.0.113.5', '203.0.113.6']);
  });

  it('flags a matching IP as excluded from visitor logs', () => {
    const excluded = mod.parseExcludedIps('203.0.113.5,203.0.113.6');
    expect(mod.isIpExcluded('203.0.113.5', excluded)).toBe(true);
  });

  it('does not flag a non-matching IP', () => {
    const excluded = mod.parseExcludedIps('203.0.113.5,203.0.113.6');
    expect(mod.isIpExcluded('198.51.100.1', excluded)).toBe(false);
  });

  it('never excludes anything when unset', () => {
    expect(mod.isIpExcluded('203.0.113.5', mod.parseExcludedIps(undefined))).toBe(false);
  });

  it('extractClientIp prefers X-Real-IP when present', () => {
    expect(mod.extractClientIp(makeFakeRequest({ 'x-real-ip': '203.0.113.5' }, '127.0.0.1'))).toBe('203.0.113.5');
  });

  it('extractClientIp falls back to the raw socket address when X-Real-IP is absent', () => {
    expect(mod.extractClientIp(makeFakeRequest({}, '127.0.0.1'))).toBe('127.0.0.1');
  });

  it('extractClientIp falls back safely even without a request object at all', () => {
    expect(mod.extractClientIp(undefined)).toBe('unknown');
  });
});

// End-to-end confirmation that DEMO_LOG_EXCLUDED_IPS actually reaches the
// logged excludedFromVisitorLogs field — separate from the pure-function
// tests above because EXCLUDED_IPS is read from process.env once at module
// load, so this needs the env var set BEFORE a fresh module import.
describe('mock-orders-ws-server — DEMO_LOG_EXCLUDED_IPS end-to-end', () => {
  const originalEnv = process.env['DEMO_LOG_EXCLUDED_IPS'];
  let mod: Awaited<ReturnType<typeof loadFreshModule>>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env['DEMO_LOG_EXCLUDED_IPS'];
    else process.env['DEMO_LOG_EXCLUDED_IPS'] = originalEnv;
    vi.restoreAllMocks();
    mod.server.close();
  });

  it('marks a connecting IP found in DEMO_LOG_EXCLUDED_IPS as isExcludedClient: true', async () => {
    process.env['DEMO_LOG_EXCLUDED_IPS'] = '203.0.113.5, 198.51.100.9';
    mod = await loadFreshModule();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mod.attachConnectionHandler();

    const client = makeFakeSocket();
    mod.wss.emit('connection', client, makeFakeRequest({ 'x-real-ip': '203.0.113.5' }));

    const logged = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
    expect(logged.isExcludedClient).toBe(true);
    expect(logged).not.toHaveProperty('clientIp');

    client.emit('close');
  });

  it('leaves a non-matching IP as isExcludedClient: false', async () => {
    process.env['DEMO_LOG_EXCLUDED_IPS'] = '203.0.113.5';
    mod = await loadFreshModule();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mod.attachConnectionHandler();

    const client = makeFakeSocket();
    mod.wss.emit('connection', client, makeFakeRequest({ 'x-real-ip': '198.51.100.1' }));

    const logged = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
    expect(logged.isExcludedClient).toBe(false);

    client.emit('close');
  });

  it('excluding an IP from visitor logs does not affect order generation for that connection', async () => {
    vi.useFakeTimers();
    process.env['DEMO_LOG_EXCLUDED_IPS'] = '203.0.113.5';
    mod = await loadFreshModule();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { getOrders } = await import('./orders-store.mjs');
    mod.attachConnectionHandler();

    const before = getOrders().length;
    const client = makeFakeSocket();
    mod.wss.emit('connection', client, makeFakeRequest({ 'x-real-ip': '203.0.113.5' }));
    vi.advanceTimersByTime(2500); // full burst

    expect(getOrders().length).toBe(before + 3); // burst still ran normally

    client.emit('close');
    vi.clearAllTimers();
    vi.useRealTimers();
  });
});

describe('mock-orders-ws-server — WS/HTTP integration', () => {
  let mod: Awaited<ReturnType<typeof loadFreshModule>>;

  beforeEach(async () => {
    mod = await loadFreshModule();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mod.server.close();
  });

  it('broadcast() reaches every currently-connected client', async () => {
    await new Promise<void>((resolve) => mod.server.listen(0, resolve));
    const address = mod.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const url = `ws://localhost:${port}/orders`;

    const clientA = new WebSocket(url);
    const clientB = new WebSocket(url);
    await Promise.all([
      new Promise<void>((resolve) => clientA.once('open', () => resolve())),
      new Promise<void>((resolve) => clientB.once('open', () => resolve())),
    ]);

    const receivedA = new Promise<string>((resolve) => clientA.once('message', (data) => resolve(data.toString())));
    const receivedB = new Promise<string>((resolve) => clientB.once('message', (data) => resolve(data.toString())));

    mod.emit(1, 42);

    const [messageA, messageB] = await Promise.all([receivedA, receivedB]);
    expect(JSON.parse(messageA)).toEqual({ type: 'order-update', payload: expect.objectContaining({ userId: 1, total: 42 }) });
    expect(JSON.parse(messageB)).toEqual({ type: 'order-update', payload: expect.objectContaining({ userId: 1, total: 42 }) });

    clientA.close();
    clientB.close();
  });

  describe('canonical retention eviction propagation over WS', () => {
    async function connectClient(): Promise<{ client: WebSocket; messages: Record<string, unknown>[] }> {
      await new Promise<void>((resolve) => mod.server.listen(0, resolve));
      const address = mod.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const client = new WebSocket(`ws://localhost:${port}/orders`);
      await new Promise<void>((resolve) => client.once('open', () => resolve()));
      const messages: Record<string, unknown>[] = [];
      client.on('message', (data) => messages.push(JSON.parse(data.toString())));
      return { client, messages };
    }

    it('does not include removedOrderIds while a user is at or under the retention cap', async () => {
      const { client, messages } = await connectClient();

      for (let i = 0; i < 5; i++) mod.emit(1);
      await vi.waitFor(() => expect(messages).toHaveLength(5));

      for (const message of messages) {
        expect(message).not.toHaveProperty('removedOrderIds');
      }
      client.close();
    });

    it('broadcasts removedOrderIds once a user crosses the retention cap, matching the evicted id', async () => {
      // Same module epoch as `mod` (no intervening vi.resetModules()) — this
      // resolves to the exact same canonical store singleton mod's emit()
      // writes into, so this reads real current state rather than assuming
      // a clean slate (BASE_ORDERS already seeds 2 orders for user 1).
      const { getOrders, MAX_ORDERS_PER_USER } = await import('./orders-store.mjs');
      const existingForUser1: { id: number; userId: number }[] = getOrders().filter(
        (o: { userId: number }) => o.userId === 1
      );
      const oldestExistingId = existingForUser1[0].id; // Map iteration order = arrival order = oldest first
      const toReachCap = MAX_ORDERS_PER_USER - existingForUser1.length;

      const { client, messages } = await connectClient();

      for (let i = 0; i < toReachCap; i++) mod.emit(1); // fills to exactly the cap, no eviction yet
      mod.emit(1); // crosses the cap by one — must evict exactly the oldest retained id
      await vi.waitFor(() => expect(messages).toHaveLength(toReachCap + 1));

      const lastMessage = messages[toReachCap];

      for (const message of messages.slice(0, toReachCap)) {
        expect(message).not.toHaveProperty('removedOrderIds');
      }
      expect(lastMessage['removedOrderIds']).toEqual([oldestExistingId]);

      client.close();
    });
  });
});
