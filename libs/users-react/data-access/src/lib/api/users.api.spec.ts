import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchUsers } from './users.api';

describe('fetchUsers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with all three users after 1500ms', async () => {
    const promise = fetchUsers();
    vi.advanceTimersByTime(1500);
    const result = await promise;
    expect(result).toHaveLength(3);
  });

  it('returns users with correct shape', async () => {
    const promise = fetchUsers();
    vi.advanceTimersByTime(1500);
    const result = await promise;
    expect(result[0]).toEqual({ id: 1, name: 'Avi Cohen' });
    expect(result[1]).toEqual({ id: 2, name: 'Dana Levi' });
    expect(result[2]).toEqual({ id: 3, name: 'Noam Katz' });
  });

  it('does not resolve before 1500ms', async () => {
    let resolved = false;
    fetchUsers().then(() => { resolved = true; });
    vi.advanceTimersByTime(1499);
    await Promise.resolve(); // flush microtasks
    expect(resolved).toBe(false);
  });
});
