import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { UserOrdersComponent } from './user-orders.component';
import { UsersFacade } from '@portal/users-angular/data-access';
import { UserOrdersVm } from '@portal/users-angular/utils';

describe('UserOrdersComponent', () => {
  let component: UserOrdersComponent;
  let fixture: ComponentFixture<UserOrdersComponent>;
  let mockFacade: {
    loadUsers: jest.Mock;
    selectUser: jest.Mock;
    dismissOrderNotification: jest.Mock;
    $vm: ReturnType<typeof signal<UserOrdersVm>>;
  };

  beforeEach(async () => {
    mockFacade = {
      loadUsers: jest.fn(),
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
      })
    };

    await TestBed.configureTestingModule({
      imports: [UserOrdersComponent], // Standalone components go in imports
      providers: [
        // 2. Override the real Facade with our Mock
        { provide: UsersFacade, useValue: mockFacade }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UserOrdersComponent);
    component = fixture.componentInstance;

    // 3. Trigger initial data binding and ngOnInit
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should call loadUsers from the facade on initialization', () => {
    // Because we called fixture.detectChanges() in beforeEach, ngOnInit has run
    expect(mockFacade.loadUsers).toHaveBeenCalledTimes(1);
  });

  it('should call selectUser on the facade when triggered', () => {
    const testUserId = 42;
    component.selectUser(testUserId);

    expect(mockFacade.selectUser).toHaveBeenCalledWith(testUserId);
  });
});
