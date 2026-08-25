import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { User } from '@portal/users/utils';
import { UserButtons } from './user-buttons';

const users: User[] = [
  { id: 1, name: 'Avi Cohen' },
  { id: 2, name: 'Dana Levi' },
];

describe('UserButtons — live order feedback', () => {
  it('shows no badge when there is no unseen count', () => {
    render(<UserButtons users={users} selectedUserId={1} onSelect={vi.fn()} unseenOrderCounts={{}} />);
    expect(screen.queryByText(/^\+\d/)).toBeNull();
  });

  it('shows a "+N" badge on an unselected user with unseen orders', () => {
    render(<UserButtons users={users} selectedUserId={1} onSelect={vi.fn()} unseenOrderCounts={{ 2: 3 }} />);
    expect(screen.getByText('+3')).toBeTruthy();
  });

  it('never shows a badge for the currently-selected user, even with a nonzero count', () => {
    render(<UserButtons users={users} selectedUserId={2} onSelect={vi.fn()} unseenOrderCounts={{ 2: 5 }} />);
    expect(screen.queryByText('+5')).toBeNull();
  });

  it('exposes the unseen count via aria-label, not color alone', () => {
    render(<UserButtons users={users} selectedUserId={1} onSelect={vi.fn()} unseenOrderCounts={{ 2: 1 }} />);
    expect(screen.getByRole('button', { name: 'Dana Levi, 1 new order' })).toBeTruthy();
  });

  it('pluralizes the aria-label for counts greater than one', () => {
    render(<UserButtons users={users} selectedUserId={1} onSelect={vi.fn()} unseenOrderCounts={{ 2: 2 }} />);
    expect(screen.getByRole('button', { name: 'Dana Levi, 2 new orders' })).toBeTruthy();
  });

  it('does not disturb the button semantics/label when there is nothing unseen', () => {
    render(<UserButtons users={users} selectedUserId={1} onSelect={vi.fn()} unseenOrderCounts={{}} />);
    const button = screen.getByRole('button', { name: 'Dana Levi' });
    expect(button.getAttribute('aria-label')).toBeNull();
  });
});
