import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BusinessAgentPanel from './business-agent-panel.vue';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('BusinessAgentPanel', () => {
  it('renders the shared business-agent-widget custom element', () => {
    const wrapper = mount(BusinessAgentPanel);
    expect(wrapper.find('business-agent-widget').exists()).toBe(true);
  });

  it('does not set an endpoint attribute when VITE_BUSINESS_AGENT_ENDPOINT is unset', () => {
    const wrapper = mount(BusinessAgentPanel);
    expect(wrapper.find('business-agent-widget').attributes('endpoint')).toBeUndefined();
  });

  it('wires the endpoint from VITE_BUSINESS_AGENT_ENDPOINT when set', () => {
    vi.stubEnv('VITE_BUSINESS_AGENT_ENDPOINT', 'http://localhost:8787/api/business-agent');
    const wrapper = mount(BusinessAgentPanel);
    expect(wrapper.find('business-agent-widget').attributes('endpoint')).toBe(
      'http://localhost:8787/api/business-agent'
    );
  });
});
