import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchOrdersByUser } from './orders.api';

describe('fetchOrdersByUser', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with orders belonging to the given user', async () => {
    const promise = fetchOrdersByUser(1);
    vi.advanceTimersByTime(800);
    const result = await promise;
    expect(result).toHaveLength(2);
    expect(result.every((o) => o.userId === 1)).toBe(true);
  });

  it('returns empty array for a user with no orders', async () => {
    const promise = fetchOrdersByUser(999);
    vi.advanceTimersByTime(800);
    const result = await promise;
    expect(result).toHaveLength(0);
  });

  it('returns correct order totals', async () => {
    const promise = fetchOrdersByUser(2);
    vi.advanceTimersByTime(800);
    const result = await promise;
    expect(result.map((o) => o.total)).toEqual([75, 350]);
  });

  it('does not resolve before 800ms', async () => {
    let resolved = false;
    fetchOrdersByUser(1).then(() => { resolved = true; });
    vi.advanceTimersByTime(799);
    await Promise.resolve();
    expect(resolved).toBe(false);
  });
});
