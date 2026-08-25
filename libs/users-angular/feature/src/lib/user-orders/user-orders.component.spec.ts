import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { signal } from '@angular/core';
import { UserOrdersComponent } from './user-orders.component';
import { UsersFacade } from '@portal/users-angular/data-access';
import { UserButtonsComponent, OrdersCardComponent } from '@portal/users-angular/ui';
import { UserOrdersVm } from '@portal/users/utils';

describe('UserOrdersComponent', () => {
  let component: UserOrdersComponent;
  let fixture: ComponentFixture<UserOrdersComponent>;
  let mockFacade: {
    selectUser: jest.Mock;
    dismissOrderNotification: jest.Mock;
    $vm: ReturnType<typeof signal<UserOrdersVm>>;
    $recentlyArrivedOrderIds: ReturnType<typeof signal<ReadonlySet<number>>>;
    $unseenOrderCountsByUserId: ReturnType<typeof signal<Readonly<Record<number, number>>>>;
  };

  beforeEach(async () => {
    mockFacade = {
      selectUser: jest.fn(),
      dismissOrderNotification: jest.fn(),
      $vm: signal<UserOrdersVm>({
        users: [{ id: 1, name: 'Avi Cohen' }],
        selectedUserId: 1,
        selectedUserSummary: { userName: 'Avi Cohen', totalAmount: 0 },
        orders: [],
        loading: false,
        loaded: true,
        error: null,
        notifications: []
      }),
      $recentlyArrivedOrderIds: signal<ReadonlySet<number>>(new Set([101])),
      $unseenOrderCountsByUserId: signal<Readonly<Record<number, number>>>({ 2: 3 })
    };

    await TestBed.configureTestingModule({
      imports: [UserOrdersComponent],
      providers: [{ provide: UsersFacade, useValue: mockFacade }],
    }).compileComponents();

    fixture = TestBed.createComponent(UserOrdersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should call selectUser on the facade when triggered', () => {
    component.selectUser(42);
    expect(mockFacade.selectUser).toHaveBeenCalledWith(42);
  });

  it('should call dismissOrderNotification on the facade when triggered', () => {
    component.dismissOrderNotification('n-1');
    expect(mockFacade.dismissOrderNotification).toHaveBeenCalledWith('n-1');
  });

  it('passes the facade\'s live-order-feedback signals down to the ui components, unwrapped', () => {
    const ordersCard = fixture.debugElement.query(By.directive(OrdersCardComponent))
      .componentInstance as OrdersCardComponent;
    const userButtons = fixture.debugElement.query(By.directive(UserButtonsComponent))
      .componentInstance as UserButtonsComponent;

    expect(ordersCard.recentlyArrivedOrderIds()).toEqual(new Set([101]));
    expect(userButtons.unseenOrderCounts()).toEqual({ 2: 3 });
    expect(ordersCard.selectedUserId()).toBe(1);
  });
});