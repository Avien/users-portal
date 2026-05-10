import { Injectable } from '@angular/core';
import { delay, Observable, of } from 'rxjs';
import { Order, User } from '@portal/users/utils';
import { MOCK_ORDERS, MOCK_USERS } from '@portal/users/utils';
/**
 * Mock data-access service for the assignment.
 * In a real application, these methods would call backend HTTP endpoints
 * via HttpClient instead of using local in-memory mock data.
 */

@Injectable({ providedIn: 'root' })
export class UserService {
  private users: User[] = [...MOCK_USERS];
  private orders: Order[] = [...MOCK_ORDERS];

  getUsers(): Observable<User[]> {
    return of([...this.users]).pipe(delay(1500));
  }

  getOrdersByUserId(userId: number): Observable<Order[]> {
    const orders = this.orders.filter((order) => order.userId === userId);
    return of(orders).pipe(delay(1000));
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
