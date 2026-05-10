import { memo } from 'react';
import type { CSSProperties } from 'react';

interface UserNameProps {
  userName: string;
}

export const UserName = memo(function UserName({ userName }: UserNameProps) {
  return (
    <div style={cardStyle}>
      <span style={labelStyle}>Selected user</span>
      <strong style={valueStyle}>{userName}</strong>
    </div>
  );
});

const cardStyle: CSSProperties = {
  padding: '1rem',
  border: '1px solid #d8dbe2',
  borderRadius: 12,
  background: '#fff',
};

const labelStyle: CSSProperties = {
  display: 'block',
  marginBottom: '0.35rem',
  fontSize: '0.85rem',
  color: '#667085',
};

const valueStyle: CSSProperties = { fontSize: '1.1rem' };
