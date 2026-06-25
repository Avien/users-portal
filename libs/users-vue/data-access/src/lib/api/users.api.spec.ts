import { fetchUsers } from './users.api';
import { MOCK_USERS } from '@portal/users/utils';

describe('fetchUsers', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves with the mock users after the delay', async () => {
    const promise = fetchUsers();
    vi.advanceTimersByTime(1500);
    await expect(promise).resolves.toEqual(MOCK_USERS);
  });
});