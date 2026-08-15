// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BusinessAgentWidget } from './business-agent-widget';
import './business-agent-widget';
import { BUSINESS_AGENT_ANSWER_EVENT, BUSINESS_AGENT_ERROR_EVENT } from './business-agent-widget.events';

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

function mount(attrs: Record<string, string> = {}): BusinessAgentWidget {
  const el = document.createElement('business-agent-widget');
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  document.body.appendChild(el);
  return el as BusinessAgentWidget;
}

function shadow(el: BusinessAgentWidget) {
  const root = el.shadowRoot;
  if (!root) throw new Error('Expected the widget to have an open shadow root');
  return {
    input: root.querySelector('input') as HTMLInputElement,
    form: root.querySelector('form') as HTMLFormElement,
    button: root.querySelector('button') as HTMLButtonElement,
    result: root.querySelector('.result') as HTMLElement,
  };
}

async function submit(el: BusinessAgentWidget, prompt: string) {
  const { input, form } = shadow(el);
  input.value = prompt;
  // A manually dispatched submit event skips native constraint validation (unlike
  // requestSubmit()), so this fires the handler regardless of the input's `required`.
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

describe('BusinessAgentWidget', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers the custom element', () => {
    expect(customElements.get('business-agent-widget')).toBeDefined();
  });

  it('gives the prompt input an accessible name', () => {
    const el = mount();
    expect(shadow(el).input.getAttribute('aria-label')).toBe('Business question');
  });

  describe('endpoint', () => {
    it('defaults to /api/business-agent', () => {
      expect(mount().endpoint).toBe('/api/business-agent');
    });

    it('uses the endpoint attribute when provided', () => {
      const el = mount({ endpoint: 'http://localhost:8787/api/business-agent' });
      expect(el.endpoint).toBe('http://localhost:8787/api/business-agent');
    });
  });

  describe('submitting a question', () => {
    it('shows a loading state and disables the button while the request is in flight', async () => {
      let resolveFetch!: (res: FakeResponse) => void;
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise<FakeResponse>((resolve) => (resolveFetch = resolve)))
      );

      const el = mount();
      await submit(el, 'How much has Dana spent?');
      const { result, button } = shadow(el);

      expect(result.dataset['state']).toBe('loading');
      expect(button.disabled).toBe(true);

      resolveFetch({ ok: true, status: 200, json: async () => ({ answer: 'done', trace: [], turns: 1 }) });
      await vi.waitFor(() => expect(result.dataset['state']).toBe('answer'));
      expect(button.disabled).toBe(false);
    });

    it('POSTs the prompt as JSON to the configured endpoint', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, json: async () => ({ answer: 'hi', trace: [], turns: 1 }) });
      vi.stubGlobal('fetch', fetchMock);

      const el = mount({ endpoint: 'http://localhost:8787/api/business-agent' });
      await submit(el, 'How much has Dana spent?');
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

      expect(fetchMock).toHaveBeenCalledWith('http://localhost:8787/api/business-agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'How much has Dana spent?' }),
      });
    });

    it('renders the answer as text and dispatches agent:answer', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            answer: 'Dana Levi has spent $238.75.',
            trace: [{ name: 'getUserOrders', input: { userId: 2 } }],
            turns: 2,
          }),
        })
      );

      const el = mount();
      const onAnswer = vi.fn();
      document.addEventListener(BUSINESS_AGENT_ANSWER_EVENT, onAnswer);

      await submit(el, 'How much has Dana spent?');
      const { result } = shadow(el);
      await vi.waitFor(() => expect(result.dataset['state']).toBe('answer'));

      expect(result.textContent).toBe('Dana Levi has spent $238.75.');
      expect(onAnswer).toHaveBeenCalledTimes(1);
      expect(onAnswer.mock.calls[0][0].detail).toEqual({
        prompt: 'How much has Dana spent?',
        answer: 'Dana Levi has spent $238.75.',
        trace: [{ name: 'getUserOrders', input: { userId: 2 } }],
        turns: 2,
      });
    });

    it('renders model output as plain text, never as HTML', async () => {
      const maliciousAnswer = '<b>bold</b><img src=x onerror="window.__pwned = true">';
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ answer: maliciousAnswer, trace: [], turns: 1 }),
        })
      );

      const el = mount();
      await submit(el, 'anything');
      const { result } = shadow(el);
      await vi.waitFor(() => expect(result.dataset['state']).toBe('answer'));

      expect(result.textContent).toBe(maliciousAnswer);
      expect(result.querySelector('b')).toBeNull();
      expect(result.querySelector('img')).toBeNull();
      expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    });

    it.each([
      ['answer is missing', { trace: [], turns: 1 }],
      ['answer is not a string', { answer: 42, trace: [], turns: 1 }],
      ['trace is not an array', { answer: 'hi', trace: 'nope', turns: 1 }],
      ['turns is not a number', { answer: 'hi', trace: [], turns: '1' }],
    ])('rejects a malformed successful response: %s', async (_label, malformedBody) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => malformedBody }));

      const el = mount();
      const onError = vi.fn();
      document.addEventListener(BUSINESS_AGENT_ERROR_EVENT, onError);

      await submit(el, 'anything');
      const { result } = shadow(el);
      await vi.waitFor(() => expect(result.dataset['state']).toBe('error'));

      expect(onError.mock.calls[0][0].detail.error).toMatch(/answer|trace|turns/i);
    });

    it('surfaces the server\'s error message on a non-OK response and dispatches agent:error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: '"prompt" is required' }) })
      );

      const el = mount();
      const onError = vi.fn();
      document.addEventListener(BUSINESS_AGENT_ERROR_EVENT, onError);

      await submit(el, 'anything');
      const { result } = shadow(el);
      await vi.waitFor(() => expect(result.dataset['state']).toBe('error'));

      expect(result.textContent).toBe('"prompt" is required');
      expect(onError.mock.calls[0][0].detail).toEqual({ prompt: 'anything', error: '"prompt" is required' });
    });

    it('handles a rejected fetch (real Error) safely', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      const el = mount();
      await submit(el, 'anything');
      const { result } = shadow(el);
      await vi.waitFor(() => expect(result.dataset['state']).toBe('error'));

      expect(result.textContent).toBe('Failed to fetch');
    });

    it('handles a rejected fetch with a non-Error value safely, without crashing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue('connection reset'));

      const el = mount();
      const onError = vi.fn();
      document.addEventListener(BUSINESS_AGENT_ERROR_EVENT, onError);

      await submit(el, 'anything');
      const { result } = shadow(el);
      await vi.waitFor(() => expect(result.dataset['state']).toBe('error'));

      expect(result.textContent).toBe('connection reset');
      expect(onError.mock.calls[0][0].detail.error).toBe('connection reset');
    });
  });
});
