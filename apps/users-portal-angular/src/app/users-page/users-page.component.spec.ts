import { TestBed } from '@angular/core/testing';
import { provideStore } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { provideUsersState } from '@portal/users-angular/data-access';
import { UsersPageComponent } from './users-page.component';

// This only proves the app-level composition (both capabilities present on the
// same page) — not UserOrders' own behavior, already covered where UserOrders
// itself lives, and not the widget's own behavior, already covered in
// libs/business-agent-widget. UserOrders needs a real (if minimal) NgRx store to
// instantiate its facade — same provider set app.spec.ts already uses.
describe('UsersPageComponent — Users/Orders + Business Agent composition', () => {
  it('renders both the Users/Orders feature and the Business Agent widget', () => {
    TestBed.configureTestingModule({
      imports: [UsersPageComponent],
      providers: [provideStore(), provideEffects(), provideUsersState()]
    });

    const fixture = TestBed.createComponent(UsersPageComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('user-orders')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('business-agent-widget')).toBeTruthy();
  });
});
