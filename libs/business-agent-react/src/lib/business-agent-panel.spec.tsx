import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { BusinessAgentPanel } from './business-agent-panel';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('BusinessAgentPanel', () => {
  it('renders the shared business-agent-widget custom element', () => {
    const { container } = render(<BusinessAgentPanel />);
    expect(container.querySelector('business-agent-widget')).toBeTruthy();
  });

  it('does not set an endpoint attribute when VITE_BUSINESS_AGENT_ENDPOINT is unset', () => {
    const { container } = render(<BusinessAgentPanel />);
    const widget = container.querySelector('business-agent-widget');
    expect(widget?.hasAttribute('endpoint')).toBe(false);
  });

  it('wires the endpoint from VITE_BUSINESS_AGENT_ENDPOINT when set', () => {
    vi.stubEnv('VITE_BUSINESS_AGENT_ENDPOINT', 'http://localhost:8787/api/business-agent');
    const { container } = render(<BusinessAgentPanel />);
    const widget = container.querySelector('business-agent-widget');
    expect(widget?.getAttribute('endpoint')).toBe('http://localhost:8787/api/business-agent');
  });
});
