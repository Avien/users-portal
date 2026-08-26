import { TestBed } from '@angular/core/testing';
import { OrdersService, ORDERS_SOCKET_URL } from './orders.service';

describe('OrdersService', () => {
  let webSocketSpy: jest.Mock;
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    webSocketSpy = jest.fn().mockImplementation(() => ({
      close: jest.fn(),
      send: jest.fn()
    }));
    // @ts-expect-error - test double, only needs to satisfy rxjs/webSocket's _connectSocket
    globalThis.WebSocket = webSocketSpy;
    localStorage.clear();
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    localStorage.clear();
  });

  function createServiceAndConnect(): void {
    TestBed.configureTestingModule({
      providers: [{ provide: ORDERS_SOCKET_URL, useValue: 'ws://localhost:3000/orders' }]
    });
    const service = TestBed.inject(OrdersService);
    // rxjs/webSocket only opens the real socket lazily on subscription.
    service.ordersUpdates$.subscribe().unsubscribe();
  }

  it('connects with the plain configured URL when no demo-owner token is set', () => {
    createServiceAndConnect();
    expect(webSocketSpy).toHaveBeenCalledWith('ws://localhost:3000/orders');
  });

  it('appends the demo-owner viewerToken to the socket URL when set in localStorage', () => {
    localStorage.setItem('usersPortalDemoOwnerToken', 'owner-abc');
    createServiceAndConnect();
    expect(webSocketSpy).toHaveBeenCalledWith('ws://localhost:3000/orders?viewerToken=owner-abc');
  });
});
