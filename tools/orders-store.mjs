// Canonical, in-memory, cross-connection Orders state — the single origin for
// every order in the system, including ones generated after process start.
// Consumed by tools/mock-orders-ws-server.mjs (WS broadcast + HTTP reads) and,
// over HTTP, by tools/business-agent-server.ts.
//
// Keep in sync with libs/users/src/lib/mocks/mock-data.ts (MOCK_ORDERS) — this
// is the pre-existing seed-data duplication already present in this file before
// this change; not introduced or fixed here.

// Demo-scale bounded retention — a long-lived Railway process would otherwise
// accumulate synthetic orders forever, growing every reader unboundedly: the
// frontend's GET /api/orders payload, the Business Agent's tool_result content
// sent back into Claude (real input-token cost), and Railway's own memory. A
// tiny count-based cap is sufficient for a demo (no TTL/DB/Redis needed) — see
// docs/business-agent.md's "Demo-scale simplifications" section.
export const MAX_ORDERS_PER_USER = 30;

const BASE_ORDERS = [
  { id: 101, userId: 1, total: 120.5, status: 'completed' },
  { id: 102, userId: 1, total: 79.9, status: 'pending' },
  { id: 201, userId: 2, total: 220, status: 'processing' },
  { id: 202, userId: 2, total: 18.75, status: 'completed' },
  { id: 301, userId: 3, total: 510.1, status: 'completed' },
  { id: 302, userId: 3, total: 99.9, status: 'cancelled' },
  { id: 303, userId: 3, total: 45, status: 'pending' },
];

// Instantiable so tests get a fresh, fully isolated store per test instead of
// mutating shared module state across the suite. Runtime uses exactly one
// instance — the `ordersStore` singleton below — never one per WS connection
// or per HTTP request; module scope (not per-connection) is what makes
// "canonical" mean anything here.
export function createOrdersStore(seedOrders = []) {
  const orders = new Map(seedOrders.map((o) => [o.id, { ...o }]));

  // Arrival metadata kept deliberately separate from Order itself — it's
  // operational/monitoring bookkeeping, not part of the Order domain contract.
  const arrivedAtByOrderId = new Map();

  // Returns which (if any) of this user's previously-retained orders were
  // just evicted by this insert — callers (the WS broadcaster) MUST propagate
  // this to already-connected clients, or their local state silently grows
  // past MAX_ORDERS_PER_USER forever while GET /api/orders, GET
  // /api/orders-snapshot, and a fresh page load all correctly stay at the cap.
  // Retention is enforced centrally here — no client re-implements it.
  function addOrder(order) {
    orders.set(order.id, { ...order });
    arrivedAtByOrderId.set(order.id, Date.now());
    const evictedOrderIds = pruneOldestForUser(order.userId);
    return { evictedOrderIds };
  }

  // Newest-wins, per-user retention. `orders` is a Map — insertion order is
  // preserved for existing keys, and every order in this system is inserted
  // exactly once with a freshly-allocated id (see allocateNewId in
  // tools/mock-orders-ws-server.mjs; nothing re-inserts an existing id), so
  // Map iteration order IS arrival order — no separate timestamp sort needed.
  // Pruning removes only the oldest excess for THIS user; other users' orders,
  // and their retained counts, are untouched. Returns the evicted ids (empty
  // array when nothing needed pruning) so the caller can propagate them.
  function pruneOldestForUser(userId) {
    const idsForUser = [...orders.values()].filter((o) => o.userId === userId).map((o) => o.id);
    const excess = idsForUser.length - MAX_ORDERS_PER_USER;
    if (excess <= 0) return [];
    const evicted = idsForUser.slice(0, excess);
    for (const id of evicted) {
      orders.delete(id);
      arrivedAtByOrderId.delete(id);
    }
    return evicted;
  }

  function getOrders() {
    return [...orders.values()];
  }

  // One synchronous read of both maps — no `await` between them, so this is
  // atomic with respect to addOrder() calls. Node is single-threaded and
  // nothing else can run between these two lines within the same tick, which
  // is what lets the Business Agent read orders + arrivals as one consistent
  // snapshot instead of two separate HTTP round-trips that could race a new order.
  function getSnapshot() {
    return {
      orders: [...orders.values()],
      arrivals: Object.fromEntries(arrivedAtByOrderId),
    };
  }

  return { addOrder, getOrders, getSnapshot };
}

// The one canonical runtime instance — shared by every WS connection and every
// HTTP request in this process.
export const ordersStore = createOrdersStore(BASE_ORDERS);

// Convenience re-exports bound to the singleton, so existing consumers
// (tools/mock-orders-ws-server.mjs) need no changes at all.
export const addOrder = ordersStore.addOrder;
export const getOrders = ordersStore.getOrders;
export const getSnapshot = ordersStore.getSnapshot;
