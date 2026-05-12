import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { UserOrdersComponent } from './user-orders.component';
import { UsersFacade } from '@portal/users-angular/data-access';
import { UserOrdersVm } from '@portal/users/utils';

describe('UserOrdersComponent', () => {
  let component: UserOrdersComponent;
  let fixture: ComponentFixture<UserOrdersComponent>;
  let mockFacade: {
    selectUser: jest.Mock;
    dismissOrderNotification: jest.Mock;
    $vm: ReturnType<typeof signal<UserOrdersVm>>;
  };

  beforeEach(async () => {
    mockFacade = {
      selectUser: jest.fn(),
      dismissOrderNotification: jest.fn(),
      $vm: signal<UserOrdersVm>({
        users: [],
        selectedUserId: null,
        selectedUserSummary: null,
        orders: [],
        loading: false,
        loaded: false,
        error: null,
        notifications: []
      }),
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
});