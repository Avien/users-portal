import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { User } from '@portal/users-angular/utils';

interface UserButtonsProps {
  users: User[];
  selectedUserId: number | null;
  onSelect: (id: number) => void;
}

export const UserButtons = memo(function UserButtons({ users, selectedUserId, onSelect }: UserButtonsProps) {
  return (
    <div style={actionsStyle}>
      {users.map((user) => (
        <button
          key={user.id}
          type="button"
          style={user.id === selectedUserId ? activeButtonStyle : buttonStyle}
          onClick={() => onSelect(user.id)}
        >
          {user.name}
        </button>
      ))}
    </div>
  );
});

const actionsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.75rem',
  marginBottom: '1.5rem',
};

const buttonStyle: CSSProperties = {
  border: '1px solid #cbd5e1',
  background: '#fff',
  borderRadius: 999,
  padding: '0.65rem 1rem',
  cursor: 'pointer',
  fontSize: 'inherit',
};

const activeButtonStyle: CSSProperties = {
  ...buttonStyle,
  borderColor: '#0f172a',
  background: '#e2e8f0',
};
