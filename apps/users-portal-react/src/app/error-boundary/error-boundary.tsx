import { Component, CSSProperties, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? <DefaultFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}

function DefaultFallback({ error }: { error: Error }) {
  return (
    <div style={containerStyle}>
      <h2 style={{ margin: '0 0 0.5rem' }}>Something went wrong</h2>
      <pre style={messageStyle}>{error.message}</pre>
    </div>
  );
}

const containerStyle: CSSProperties = {
  maxWidth: 600,
  margin: '2rem auto',
  padding: '1.5rem',
  border: '1px solid #fca5a5',
  borderRadius: 8,
  background: '#fef2f2',
  color: '#dc2626',
};

const messageStyle: CSSProperties = {
  margin: 0,
  fontSize: '0.875rem',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};