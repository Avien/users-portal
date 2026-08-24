import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { delay, map, Observable, of } from 'rxjs';
import { Order, User, getOrdersByUserId as filterOrdersByUserId } from '@portal/users/utils';
import { MOCK_ORDERS, MOCK_USERS } from '@portal/users/utils';
import { ORDERS_API_URL } from './orders.service';
/**
 * Mock data-access service for the assignment (Users CRUD only — Orders reads
 * are real HTTP, see getOrdersByUserId below).
 * In a real application, the remaining methods would call backend HTTP
 * endpoints via HttpClient instead of using local in-memory mock data.
 */

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly http = inject(HttpClient);
  private readonly ordersApiUrl = inject(ORDERS_API_URL);

  private users: User[] = [...MOCK_USERS];
  // Mock-CRUD bookkeeping only for deleteUser() below — no longer read by
  // getOrdersByUserId, which now reads the canonical Orders store over HTTP.
  private orders: Order[] = [...MOCK_ORDERS];

  getUsers(): Observable<User[]> {
    return of([...this.users]).pipe(delay(1500));
  }

  // Reads the same canonical current-orders source the Business Agent reads
  // (GET {ordersApiUrl}) — not a static snapshot frozen at process start — so
  // the UI agrees with the agent and WS deltas merge onto real data. WS deltas
  // are merged on top of this by OrdersService/the NgRx effect+reducer.
  getOrdersByUserId(userId: number): Observable<Order[]> {
    return this.http
      .get<Order[]>(this.ordersApiUrl)
      .pipe(map((orders) => filterOrdersByUserId(orders, userId)));
  }

  addUser(user: User): Observable<User> {
    this.users = [...this.users, user];
    return of(user).pipe(delay(150));
  }

  updateUser(user: User): Observable<User> {
    this.users = this.users.map((existing) => (existing.id === user.id ? user : existing));
    return of(user).pipe(delay(150));
  }

  deleteUser(userId: number): Observable<void> {
    this.users = this.users.filter((user) => user.id !== userId);
    this.orders = this.orders.filter((order) => order.userId !== userId);
    return of(void 0).pipe(delay(150));
  }
}
