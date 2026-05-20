import { WebSocketServer } from 'ws';

const PORT = process.env['PORT'] ? Number(process.env['PORT']) : 3000;
const wss = new WebSocketServer({ port: PORT, path: '/orders' });

// Keep in sync with `libs/users/data-access/src/lib/services/user.mocks.ts` (MOCK_ORDERS).
const baseOrders = [
  { id: 101, userId: 1, total: 120.5 },
  { id: 102, userId: 1, total: 79.9 },
  { id: 201, userId: 2, total: 220 },
  { id: 202, userId: 2, total: 18.75 },
  { id: 301, userId: 3, total: 510.1 },
  { id: 302, userId: 3, total: 99.9 },
  { id: 303, userId: 3, total: 45 }
];

const userIds = [1, 2, 3];

const randomIntInclusive = (min, max) => {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
};

const randomMoney = () => Number((Math.random() * 750 + 25).toFixed(2));

console.log(`Mock WS running at ws://localhost:${PORT}/orders`);

wss.on('connection', (socket) => {
  console.log('Client connected to mock orders socket');

  const liveOrders = new Map(baseOrders.map((o) => [o.id, { ...o }]));

  const nextIdByUser = new Map(
    userIds.map((userId) => {
      const maxForUser = Math.max(
        0,
        ...[...liveOrders.values()].filter((o) => o.userId === userId).map((o) => o.id)
      );
      return [userId, maxForUser + 1];
    })
  );

  const allocateNewId = (userId) => {
    let candidate = nextIdByUser.get(userId) ?? userId * 100 + 1;
    while (liveOrders.has(candidate)) {
      candidate += 1;
    }
    nextIdByUser.set(userId, candidate + 1);
    return candidate;
  };

  const emit = (userId, total = randomMoney()) => {
    const id = allocateNewId(userId);
    const payload = { id, userId, total: Number(total.toFixed(2)) };
    liveOrders.set(payload.id, { ...payload });
    console.log(`WS emit order id=${payload.id} userId=${payload.userId} total=${payload.total}`);
    socket.send(JSON.stringify({ type: 'order-update', payload }));
  };

  // Three rapid orders for the same user on connect:
  // - first order is swallowed by the learning tick (monitoring baseline)
  // - second order total >= $500 → triggers the high-value warning toast
  // - third order within the burst window → triggers the critical burst toast
  const burstUserId = userIds[0];
  const burstTimer1 = setTimeout(() => emit(burstUserId), 500);
  const burstTimer2 = setTimeout(() => emit(burstUserId, randomMoney() + 500), 1500);
  const burstTimer3 = setTimeout(() => emit(burstUserId), 2500);

  const scheduleNext = () => {
    const delayMs = randomIntInclusive(5000, 15000);
    return setTimeout(() => {
      emit(userIds[randomIntInclusive(0, userIds.length - 1)]);
      timer = scheduleNext();
    }, delayMs);
  };

  let timer = scheduleNext();

  socket.on('close', () => {
    clearTimeout(burstTimer1);
    clearTimeout(burstTimer2);
    clearTimeout(burstTimer3);
    clearTimeout(timer);
    console.log('Client disconnected from mock orders socket');
  });
});
