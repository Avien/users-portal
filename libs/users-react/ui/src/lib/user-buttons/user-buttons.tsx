import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { User } from '@portal/users/utils';
import styles from './user-buttons.module.css';

interface UserButtonsProps {
  users: User[];
  selectedUserId: number | null;
  onSelect: (id: number) => void;
  unseenOrderCounts: Readonly<Record<number, number>>;
}

export const UserButtons = memo(function UserButtons({
  users,
  selectedUserId,
  onSelect,
  unseenOrderCounts,
}: UserButtonsProps) {
  return (
    <div style={actionsStyle}>
      {users.map((user) => {
        const isSelected = user.id === selectedUserId;
        const unseenCount = unseenOrderCounts[user.id] ?? 0;
        return (
          <button
            key={user.id}
            type="button"
            className={styles['button']}
            style={isSelected ? activeButtonStyle : buttonStyle}
            aria-label={
              !isSelected && unseenCount > 0
                ? `${user.name}, ${unseenCount} new order${unseenCount === 1 ? '' : 's'}`
                : undefined
            }
            onClick={() => onSelect(user.id)}
          >
            {user.name}
            {!isSelected && unseenCount > 0 && (
              <span className={styles['badge']} aria-hidden="true">
                +{unseenCount}
              </span>
            )}
          </button>
        );
      })}
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
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: '#cbd5e1',
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
