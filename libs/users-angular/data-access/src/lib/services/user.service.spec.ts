import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { Order } from '@portal/users/utils';
import { UserService } from './user.service';
import { ORDERS_API_URL } from './orders.service';

const TEST_ORDERS_API_URL = 'http://test-orders-api/api/orders';

const CANONICAL_RESPONSE: Order[] = [
  { id: 101, userId: 1, total: 120.5, status: 'completed' },
  { id: 102, userId: 1, total: 79.9, status: 'pending' },
  { id: 201, userId: 2, total: 220, status: 'processing' },
];

describe('UserService', () => {
  let service: UserService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        UserService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ORDERS_API_URL, useValue: TEST_ORDERS_API_URL },
      ],
    });
    service = TestBed.inject(UserService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('GETs the canonical orders endpoint', () => {
    service.getOrdersByUserId(1).subscribe();
    const req = httpMock.expectOne(TEST_ORDERS_API_URL);
    expect(req.request.method).toBe('GET');
    req.flush(CANONICAL_RESPONSE);
  });

  it('resolves with only the given user\'s orders', async () => {
    const promise = firstValueFrom(service.getOrdersByUserId(1));
    httpMock.expectOne(TEST_ORDERS_API_URL).flush(CANONICAL_RESPONSE);
    const result = await promise;
    expect(result).toHaveLength(2);
    expect(result.every((o) => o.userId === 1)).toBe(true);
  });

  it('returns an empty array for a user with no orders', async () => {
    const promise = firstValueFrom(service.getOrdersByUserId(999));
    httpMock.expectOne(TEST_ORDERS_API_URL).flush(CANONICAL_RESPONSE);
    const result = await promise;
    expect(result).toHaveLength(0);
  });

  it('reflects orders beyond the original static mock set — current, not frozen, data', async () => {
    const promise = firstValueFrom(service.getOrdersByUserId(1));
    httpMock
      .expectOne(TEST_ORDERS_API_URL)
      .flush([...CANONICAL_RESPONSE, { id: 103, userId: 1, total: 999, status: 'completed' }]);
    const result = await promise;
    expect(result).toHaveLength(3);
    expect(result.some((o) => o.id === 103)).toBe(true);
  });

  it('propagates an error when the orders API responds with a non-OK status', async () => {
    const promise = firstValueFrom(service.getOrdersByUserId(1));
    httpMock.expectOne(TEST_ORDERS_API_URL).flush('server error', { status: 500, statusText: 'Internal Server Error' });
    await expect(promise).rejects.toBeTruthy();
  });
});
