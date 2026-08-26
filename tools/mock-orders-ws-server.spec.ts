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

function makeFakeRequest(url = '/orders') {
  return { url };
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

  it('logs a structured connect event with the active client count and exclusion flag', () => {
    mod.attachConnectionHandler();
    const clientA = makeFakeSocket();
    mod.wss.emit('connection', clientA, makeFakeRequest());

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
    mod.wss.emit('connection', clientA, makeFakeRequest());
    mod.wss.emit('connection', clientB, makeFakeRequest());

    clientA.emit('close');
    expect(lastLoggedJson()).toEqual({
      message: 'WS client disconnected',
      activeClients: 1,
      isExcludedClient: false,
    });

    clientB.emit('close');
    expect(lastLoggedJson()).toMatchObject({ message: 'WS client disconnected', activeClients: 0 });
  });

  it('never includes the viewer token (or any other raw identifier) in the logged line', () => {
    mod.attachConnectionHandler();

    const clientA = makeFakeSocket();
    mod.wss.emit('connection', clientA, makeFakeRequest('/orders?viewerToken=super-secret-value'));
    const logged = lastLoggedJson();
    expect(logged).not.toHaveProperty('viewerToken');
    expect(logged).not.toHaveProperty('token');
    expect(JSON.stringify(logged)).not.toContain('super-secret-value');
    clientA.emit('close');
  });
});

describe('mock-orders-ws-server — DEMO_LOG_EXCLUDED_TOKEN (log classification only)', () => {
  let mod: Awaited<ReturnType<typeof loadFreshModule>>;

  beforeEach(async () => {
    mod = await loadFreshModule();
  });

  afterEach(() => {
    mod.server.close();
  });

  it('is never excluded when no server token is configured, regardless of viewer token', () => {
    expect(mod.isViewerTokenExcluded('anything', '')).toBe(false);
    expect(mod.isViewerTokenExcluded('anything', undefined)).toBe(false);
    expect(mod.isViewerTokenExcluded('anything', null)).toBe(false);
  });

  it('is false when a server token is configured but no viewer token was sent', () => {
    expect(mod.isViewerTokenExcluded(null, 'owner-secret')).toBe(false);
    expect(mod.isViewerTokenExcluded(undefined, 'owner-secret')).toBe(false);
    expect(mod.isViewerTokenExcluded('', 'owner-secret')).toBe(false);
  });

  it('is false for a mismatched token', () => {
    expect(mod.isViewerTokenExcluded('wrong-value', 'owner-secret')).toBe(false);
  });

  it('is true for an exact match', () => {
    expect(mod.isViewerTokenExcluded('owner-secret', 'owner-secret')).toBe(true);
  });

  it('is false when both sides are empty strings', () => {
    expect(mod.isViewerTokenExcluded('', '')).toBe(false);
  });

  it('extractViewerToken reads viewerToken from the query string alongside other params', () => {
    expect(mod.extractViewerToken(makeFakeRequest('/orders?foo=bar&viewerToken=owner-secret&baz=qux'))).toBe(
      'owner-secret'
    );
  });

  it('extractViewerToken returns null when the query string has no viewerToken', () => {
    expect(mod.extractViewerToken(makeFakeRequest('/orders?foo=bar'))).toBeNull();
    expect(mod.extractViewerToken(makeFakeRequest('/orders'))).toBeNull();
  });

  it('extractViewerToken falls back safely without a request object or url at all', () => {
    expect(mod.extractViewerToken(undefined)).toBeNull();
    expect(mod.extractViewerToken({})).toBeNull();
  });
});

// End-to-end confirmation that DEMO_LOG_EXCLUDED_TOKEN actually reaches the
// logged isExcludedClient field — separate from the pure-function tests
// above because the server token is read from process.env once at module
// load, so this needs the env var set BEFORE a fresh module import.
describe('mock-orders-ws-server — DEMO_LOG_EXCLUDED_TOKEN end-to-end', () => {
  const originalEnv = process.env['DEMO_LOG_EXCLUDED_TOKEN'];
  let mod: Awaited<ReturnType<typeof loadFreshModule>>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env['DEMO_LOG_EXCLUDED_TOKEN'];
    else process.env['DEMO_LOG_EXCLUDED_TOKEN'] = originalEnv;
    vi.restoreAllMocks();
    mod.server.close();
  });

  it('marks a connection with a matching viewerToken as isExcludedClient: true, without logging the token', async () => {
    process.env['DEMO_LOG_EXCLUDED_TOKEN'] = 'owner-secret';
    mod = await loadFreshModule();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mod.attachConnectionHandler();

    const client = makeFakeSocket();
    mod.wss.emit('connection', client, makeFakeRequest('/orders?viewerToken=owner-secret'));

    const logged = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
    expect(logged.isExcludedClient).toBe(true);
    expect(JSON.stringify(logged)).not.toContain('owner-secret');

    client.emit('close');
  });

  it('leaves a connection with a mismatched viewerToken as isExcludedClient: false', async () => {
    process.env['DEMO_LOG_EXCLUDED_TOKEN'] = 'owner-secret';
    mod = await loadFreshModule();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mod.attachConnectionHandler();

    const client = makeFakeSocket();
    mod.wss.emit('connection', client, makeFakeRequest('/orders?viewerToken=someone-elses-value'));

    const logged = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
    expect(logged.isExcludedClient).toBe(false);

    client.emit('close');
  });

  it('leaves a connection with no viewerToken as isExcludedClient: false, even with a server token configured', async () => {
    process.env['DEMO_LOG_EXCLUDED_TOKEN'] = 'owner-secret';
    mod = await loadFreshModule();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mod.attachConnectionHandler();

    const client = makeFakeSocket();
    mod.wss.emit('connection', client, makeFakeRequest('/orders'));

    const logged = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
    expect(logged.isExcludedClient).toBe(false);

    client.emit('close');
  });

  it('an excluded (owner/test) connection still receives normal burst orders, with no change to active-client counting', async () => {
    vi.useFakeTimers();
    process.env['DEMO_LOG_EXCLUDED_TOKEN'] = 'owner-secret';
    mod = await loadFreshModule();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { getOrders } = await import('./orders-store.mjs');
    mod.attachConnectionHandler();

    const before = getOrders().length;
    const client = makeFakeSocket();
    mod.wss.emit('connection', client, makeFakeRequest('/orders?viewerToken=owner-secret'));
    expect(JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string)).toMatchObject({ activeClients: 1 });

    vi.advanceTimersByTime(2500); // full burst
    expect(getOrders().length).toBe(before + 3); // burst ran normally despite being an excluded/owner connection

    client.emit('close');
    expect(JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string)).toMatchObject({ activeClients: 0 });

    vi.clearAllTimers();
    vi.useRealTimers();
  });
});

describe('mock-orders-ws-server — external-viewer awareness in order logs', () => {
  const originalEnv = process.env['DEMO_LOG_EXCLUDED_TOKEN'];
  let mod: Awaited<ReturnType<typeof loadFreshModule>>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env['DEMO_LOG_EXCLUDED_TOKEN'];
    else process.env['DEMO_LOG_EXCLUDED_TOKEN'] = originalEnv;
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    mod.server.close();
  });

  function orderLogs(): Record<string, unknown>[] {
    return logSpy.mock.calls
      .map((call) => JSON.parse(call[0] as string))
      .filter((log) => log['message'] === 'WS emit order');
  }

  it('an excluded-only connection produces order logs with activeExternalClients: 0', async () => {
    process.env['DEMO_LOG_EXCLUDED_TOKEN'] = 'owner-secret';
    mod = await loadFreshModule();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mod.attachConnectionHandler();

    const owner = makeFakeSocket();
    mod.wss.emit('connection', owner, makeFakeRequest('/orders?viewerToken=owner-secret'));
    vi.advanceTimersByTime(500); // first burst order

    const logs = orderLogs();
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      expect(log['activeClients']).toBe(1);
      expect(log['activeExternalClients']).toBe(0);
    }

    owner.emit('close');
  });

  it('one normal/external client produces order logs with activeExternalClients: 1', async () => {
    mod = await loadFreshModule();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mod.attachConnectionHandler();

    const external = makeFakeSocket();
    mod.wss.emit('connection', external, makeFakeRequest());
    vi.advanceTimersByTime(500);

    const logs = orderLogs();
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      expect(log['activeExternalClients']).toBe(1);
    }

    external.emit('close');
  });

  it('an excluded client plus an external client: activeExternalClients counts only the external one', async () => {
    process.env['DEMO_LOG_EXCLUDED_TOKEN'] = 'owner-secret';
    mod = await loadFreshModule();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mod.attachConnectionHandler();

    const owner = makeFakeSocket();
    mod.wss.emit('connection', owner, makeFakeRequest('/orders?viewerToken=owner-secret'));
    const external = makeFakeSocket();
    mod.wss.emit('connection', external, makeFakeRequest());

    vi.advanceTimersByTime(500);
    const logs = orderLogs();
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      expect(log['activeClients']).toBe(2);
      expect(log['activeExternalClients']).toBe(1);
    }

    owner.emit('close');
    external.emit('close');
  });

  it('multiple external clients increment activeExternalClients correctly', async () => {
    mod = await loadFreshModule();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mod.attachConnectionHandler();

    const a = makeFakeSocket();
    const b = makeFakeSocket();
    const c = makeFakeSocket();
    mod.wss.emit('connection', a, makeFakeRequest());
    mod.wss.emit('connection', b, makeFakeRequest());
    mod.wss.emit('connection', c, makeFakeRequest());

    vi.advanceTimersByTime(500);
    const logs = orderLogs();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.at(-1)?.['activeExternalClients']).toBe(3);

    a.emit('close');
    b.emit('close');
    c.emit('close');
  });

  it('an external disconnect decrements activeExternalClients', async () => {
    mod = await loadFreshModule();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mod.attachConnectionHandler();

    const a = makeFakeSocket();
    const b = makeFakeSocket();
    mod.wss.emit('connection', a, makeFakeRequest());
    mod.wss.emit('connection', b, makeFakeRequest());
    a.emit('close'); // one external disconnects, one remains

    // b's own burst never re-fires (already-active session) — use the
    // recurring generator to observe a fresh order log's counts instead.
    mod.wss.clients.add(makeFakeWsClient() as never);
    mod.scheduleNextGeneratedOrder();
    vi.advanceTimersByTime(15000);

    const logs = orderLogs();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.at(-1)?.['activeExternalClients']).toBe(1);

    b.emit('close');
  });

  it('an excluded client disconnecting does not decrement activeExternalClients', async () => {
    process.env['DEMO_LOG_EXCLUDED_TOKEN'] = 'owner-secret';
    mod = await loadFreshModule();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mod.attachConnectionHandler();

    const external = makeFakeSocket();
    mod.wss.emit('connection', external, makeFakeRequest());
    const owner = makeFakeSocket();
    mod.wss.emit('connection', owner, makeFakeRequest('/orders?viewerToken=owner-secret'));

    owner.emit('close'); // excluded disconnect — must not touch activeExternalClients

    mod.wss.clients.add(makeFakeWsClient() as never);
    mod.scheduleNextGeneratedOrder();
    vi.advanceTimersByTime(15000);

    const logs = orderLogs();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.at(-1)?.['activeExternalClients']).toBe(1); // unchanged by the owner's disconnect

    external.emit('close');
  });

  it('a double-close on one socket decrements both counters exactly once, not twice, while another client is still connected', async () => {
    mod = await loadFreshModule();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mod.attachConnectionHandler();

    const a = makeFakeSocket();
    const b = makeFakeSocket();
    mod.wss.emit('connection', a, makeFakeRequest());
    mod.wss.emit('connection', b, makeFakeRequest());
    // Both external — count is 2 before anything closes.

    a.emit('close'); // -> 1
    a.emit('close'); // double-close for the SAME socket — must not steal b's count

    mod.wss.clients.add(makeFakeWsClient() as never);
    mod.scheduleNextGeneratedOrder();
    vi.advanceTimersByTime(15000);

    const logs = orderLogs();
    expect(logs.length).toBeGreaterThan(0);
    // b is still connected — the correct count is 1, not 0.
    expect(logs.at(-1)?.['activeClients']).toBe(1);
    expect(logs.at(-1)?.['activeExternalClients']).toBe(1);

    b.emit('close'); // -> 0, normal disconnect
    logSpy.mockClear();
    // wss.clients still holds the placeholder added above, so the generator
    // gate stays open — this tick exists purely to observe the counters
    // after b's disconnect, not to test the pause-while-idle gate itself.
    vi.advanceTimersByTime(15000);

    const afterBothClosed = orderLogs();
    expect(afterBothClosed.length).toBeGreaterThan(0);
    expect(afterBothClosed.at(-1)?.['activeClients']).toBe(0);
    expect(afterBothClosed.at(-1)?.['activeExternalClients']).toBe(0);
  });

  it('the viewer token never appears anywhere in an order log, even while a matching connection is active', async () => {
    process.env['DEMO_LOG_EXCLUDED_TOKEN'] = 'owner-secret';
    mod = await loadFreshModule();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mod.attachConnectionHandler();

    const owner = makeFakeSocket();
    mod.wss.emit('connection', owner, makeFakeRequest('/orders?viewerToken=owner-secret'));
    vi.advanceTimersByTime(2500); // full burst

    const logs = orderLogs();
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      expect(JSON.stringify(log)).not.toContain('owner-secret');
    }

    owner.emit('close');
  });
});

describe('mock-orders-ws-server — order log eviction field', () => {
  let mod: Awaited<ReturnType<typeof loadFreshModule>>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    mod = await loadFreshModule();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mod.server.close();
  });

  it('includes evictedOrderId in the order log once a user crosses the retention cap', async () => {
    const { getOrders, MAX_ORDERS_PER_USER } = await import('./orders-store.mjs');
    const existingForUser1: { id: number; userId: number }[] = getOrders().filter(
      (o: { userId: number }) => o.userId === 1
    );
    const oldestExistingId = existingForUser1[0].id;
    const toReachCap = MAX_ORDERS_PER_USER - existingForUser1.length;

    for (let i = 0; i < toReachCap; i++) mod.emit(1);
    logSpy.mockClear();
    mod.emit(1); // crosses the cap by one

    const logged = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
    expect(logged['message']).toBe('WS emit order');
    expect(logged['evictedOrderId']).toBe(oldestExistingId);
  });

  it('omits evictedOrderId entirely while a user is at or under the retention cap', () => {
    logSpy.mockClear();
    mod.emit(1);

    const logged = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
    expect(logged).not.toHaveProperty('evictedOrderId');
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
