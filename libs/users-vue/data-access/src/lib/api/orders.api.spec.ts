import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchOrdersByUser } from './orders.api';

const CANONICAL_RESPONSE = [
  { id: 101, userId: 1, total: 120.5, status: 'completed' },
  { id: 102, userId: 1, total: 79.9, status: 'pending' },
  { id: 201, userId: 2, total: 220, status: 'processing' },
  { id: 202, userId: 2, total: 18.75, status: 'completed' },
];

function mockOrdersResponse(orders: unknown[], ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, status, json: async () => orders }));
}

describe('fetchOrdersByUser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves with orders belonging to the given user', async () => {
    mockOrdersResponse(CANONICAL_RESPONSE);
    const result = await fetchOrdersByUser(1);
    expect(result).toHaveLength(2);
    expect(result.every((o) => o.userId === 1)).toBe(true);
  });

  it('returns empty array for a user with no orders', async () => {
    mockOrdersResponse(CANONICAL_RESPONSE);
    const result = await fetchOrdersByUser(999);
    expect(result).toHaveLength(0);
  });

  it('returns correct order totals', async () => {
    mockOrdersResponse(CANONICAL_RESPONSE);
    const result = await fetchOrdersByUser(2);
    expect(result.map((o) => o.total)).toEqual([220, 18.75]);
  });

  it('reflects orders beyond the original static mock set — current, not frozen, data', async () => {
    mockOrdersResponse([...CANONICAL_RESPONSE, { id: 103, userId: 1, total: 999, status: 'completed' }]);
    const result = await fetchOrdersByUser(1);
    expect(result).toHaveLength(3);
    expect(result.some((o) => o.id === 103)).toBe(true);
  });

  it('throws when the orders API responds with a non-OK status', async () => {
    mockOrdersResponse([], false, 500);
    await expect(fetchOrdersByUser(1)).rejects.toThrow();
  });
});
