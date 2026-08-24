import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './app';

// This only proves the app-level composition (both capabilities present on the
// same page, no dedicated /business-agent route) — not UserOrders' own behavior,
// which is already covered where UserOrders itself lives, and not the widget's
// own behavior, already covered in libs/business-agent-widget.
vi.mock('@portal/users-react/feature', () => ({
  UserOrders: () => <div data-testid="user-orders" />,
}));
vi.mock('@portal/users-react/data-access', () => ({
  useOrdersStream: () => undefined,
}));

describe('App — Users/Orders + Business Agent composition', () => {
  it('renders both the Users/Orders feature and the Business Agent widget on /users', () => {
    render(
      <MemoryRouter initialEntries={['/users']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByTestId('user-orders')).toBeTruthy();
    expect(document.querySelector('business-agent-widget')).toBeTruthy();
  });

  it('no longer has a standalone /business-agent route', () => {
    render(
      <MemoryRouter initialEntries={['/business-agent']}>
        <App />
      </MemoryRouter>
    );
    // Falls through the catch-all redirect to /users instead of a dedicated page.
    expect(screen.getByTestId('user-orders')).toBeTruthy();
  });
});
