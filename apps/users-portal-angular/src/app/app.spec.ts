import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { provideUsersState } from '@fmr/users-angular/data-access';

// 1. Import the root initializers
import { provideStore } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),

        // 2. Initialize the Root Store and Effects for the test environment
        provideStore(),
        provideEffects(),

        // 3. Now the feature state can attach successfully
        provideUsersState()
      ]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
