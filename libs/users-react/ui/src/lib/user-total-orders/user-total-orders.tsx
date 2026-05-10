import { memo } from 'react';
import type { CSSProperties } from 'react';

interface UserTotalOrdersProps {
  totalAmount: number;
}

export const UserTotalOrders = memo(function UserTotalOrders({ totalAmount }: UserTotalOrdersProps) {
  return (
    <div style={cardStyle}>
      <span style={labelStyle}>Total orders</span>
      <strong style={valueStyle}>${totalAmount.toFixed(2)}</strong>
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
