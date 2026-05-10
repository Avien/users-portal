import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UserTotalOrdersComponent } from './user-total-orders.component';

describe('UserTotalOrdersComponent', () => {
  let component: UserTotalOrdersComponent;
  let fixture: ComponentFixture<UserTotalOrdersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserTotalOrdersComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(UserTotalOrdersComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
