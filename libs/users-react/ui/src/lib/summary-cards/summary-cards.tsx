import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { UserOrderSummary } from '@fmr/users-angular/utils';

interface SummaryCardsProps {
  summary: UserOrderSummary;
}

export const SummaryCards = memo(function SummaryCards({ summary }: SummaryCardsProps) {
  return (
    <div style={gridStyle}>
      <div style={cardStyle}>
        <span style={labelStyle}>Selected user</span>
        <strong style={valueStyle}>{summary.userName}</strong>
      </div>
      <div style={cardStyle}>
        <span style={labelStyle}>Total orders</span>
        <strong style={valueStyle}>${summary.totalAmount.toFixed(2)}</strong>
      </div>
    </div>
  );
});

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '1rem',
  marginBottom: '1.5rem',
};

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

const valueStyle: CSSProperties = {
  fontSize: '1.1rem',
};
