import { fetchOrdersByUser } from './orders.api';
import { MOCK_ORDERS } from '@portal/users/utils';

describe('fetchOrdersByUser', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves with only the given user\'s orders after the delay', async () => {
    const promise = fetchOrdersByUser(1);
    vi.advanceTimersByTime(800);
    await expect(promise).resolves.toEqual(MOCK_ORDERS.filter((o) => o.userId === 1));
  });
});