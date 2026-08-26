import { buildOrdersSocketUrl, DEMO_OWNER_TOKEN_STORAGE_KEY } from './orders-ws-url.utils';

describe('orders-ws-url.utils', () => {
  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it('returns the URL unchanged when no token is stored', () => {
    expect(buildOrdersSocketUrl('ws://localhost:3000/orders')).toBe('ws://localhost:3000/orders');
  });

  it('appends viewerToken with a "?" when the base URL has no existing query string', () => {
    localStorage.setItem(DEMO_OWNER_TOKEN_STORAGE_KEY, 'abc123');
    expect(buildOrdersSocketUrl('wss://example.up.railway.app/orders')).toBe(
      'wss://example.up.railway.app/orders?viewerToken=abc123'
    );
  });

  it('appends viewerToken with a "&" when the base URL already has a query string', () => {
    localStorage.setItem(DEMO_OWNER_TOKEN_STORAGE_KEY, 'abc123');
    expect(buildOrdersSocketUrl('wss://example.up.railway.app/orders?foo=bar')).toBe(
      'wss://example.up.railway.app/orders?foo=bar&viewerToken=abc123'
    );
  });

  it('URL-encodes the stored token', () => {
    localStorage.setItem(DEMO_OWNER_TOKEN_STORAGE_KEY, 'has spaces & symbols');
    expect(buildOrdersSocketUrl('wss://example.up.railway.app/orders')).toBe(
      'wss://example.up.railway.app/orders?viewerToken=has%20spaces%20%26%20symbols'
    );
  });

  it('treats an empty-string token as absent', () => {
    localStorage.setItem(DEMO_OWNER_TOKEN_STORAGE_KEY, '');
    expect(buildOrdersSocketUrl('ws://localhost:3000/orders')).toBe('ws://localhost:3000/orders');
  });

  it('falls back to no token if localStorage access throws', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(buildOrdersSocketUrl('ws://localhost:3000/orders')).toBe('ws://localhost:3000/orders');
  });
});
