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

  it('one connection triggers the burst; a second, later connection does not re-trigger it', () => {
    mod.attachConnectionHandler();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const clientA = makeFakeSocket();
    mod.wss.emit('connection', clientA);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(3);

    clientA.emit('close'); // disconnecting one client...

    const clientB = makeFakeSocket();
    mod.wss.emit('connection', clientB); // ...must not let a later connection re-trigger the burst
    expect(setTimeoutSpy).toHaveBeenCalledTimes(3);

    clientB.emit('close');
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
