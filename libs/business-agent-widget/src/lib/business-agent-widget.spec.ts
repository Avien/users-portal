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
    button: root.querySelector('button[type="submit"]') as HTMLButtonElement,
    // Scoped to the class, not the bare `button[type="button"]` attribute
    // selector — the info-icon (added for the data-scope tooltip) is also a
    // type="button" element and now appears earlier in DOM order, so the old
    // attribute-only selector would silently match it instead.
    resetButton: root.querySelector('.reset-button') as HTMLButtonElement,
    // Transient loading/error presentation only — successful answers live in the transcript.
    status: root.querySelector('.status') as HTMLElement,
    transcript: root.querySelector('.transcript') as HTMLElement,
  };
}

// The visible You/Agent transcript, in order — this is what a user actually sees,
// rendered from `this.history`. The `history` POSTed with the next request is a
// separately-bounded copy of that same array (see boundHistoryForRequest) — always
// equal to it for short answers, but not for one over MAX_HISTORY_MESSAGE_LENGTH.
function transcriptMessages(el: BusinessAgentWidget) {
  const { transcript } = shadow(el);
  return Array.from(transcript.querySelectorAll('.message')).map((node) => ({
    role: node.getAttribute('data-role'),
    text: node.querySelector('.message-body')?.textContent ?? '',
  }));
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

  it('gives the reset button a clear accessible name and a type that cannot submit the form', () => {
    const { resetButton } = shadow(mount());
    expect(resetButton.getAttribute('aria-label')).toBe('Start new conversation');
    expect(resetButton.textContent).toBe('Start new conversation');
    expect(resetButton.getAttribute('type')).toBe('button');
  });

  describe('endpoint', () => {
    it('defaults to /api/business-agent', () => {
      expect(mount().endpoint).toBe('/api/business-agent');
    });

    it('uses the endpoint attribute when provided', () => {
      const el = mount({ endpoint: 'http://localhost:8787/api/business-agent' });
      expect(el.endpoint).toBe('http://localhost:8787/api/business-agent');
    });

    it('reflects a property assignment to the attribute (React/Angular/Vue property binding)', () => {
      const el = mount();
      el.endpoint = 'http://localhost:8787/api/business-agent';
      expect(el.getAttribute('endpoint')).toBe('http://localhost:8787/api/business-agent');
      expect(el.endpoint).toBe('http://localhost:8787/api/business-agent');
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['empty string', ''],
    ])('setting endpoint to %s removes the attribute and falls back to the default', (_label, value) => {
      const el = mount({ endpoint: 'http://localhost:8787/api/business-agent' });
      el.endpoint = value;
      expect(el.hasAttribute('endpoint')).toBe(false);
      expect(el.endpoint).toBe('/api/business-agent');
    });
  });

  describe('data-scope info tooltip', () => {
    it('keeps the existing heading unchanged', () => {
      const root = mount().shadowRoot as ShadowRoot;
      expect(root.querySelector('h2')?.textContent).toBe('LLM-Powered Business Agent');
    });

    it('restores the compact header — no permanently visible scope line, so "Start new conversation" has nothing extra pushing it around', () => {
      const root = mount().shadowRoot as ShadowRoot;
      expect(root.querySelector('.data-scope-hint')).toBeNull();
      // The left column of the header is just the heading + one descriptor line
      // (plus the inline icon/tooltip, which add no block-level height of their
      // own) — no second paragraph competing for vertical space.
      const headerLeft = root.querySelector('.header > div') as HTMLElement;
      expect(headerLeft.querySelectorAll('p')).toHaveLength(1);
    });

    it('renders an accessible, keyboard-focusable info icon next to the descriptor, describing the tooltip', () => {
      const root = mount().shadowRoot as ShadowRoot;
      const icon = root.querySelector('.info-icon') as HTMLButtonElement;
      expect(icon).not.toBeNull();
      expect(icon.tagName).toBe('BUTTON');
      expect(icon.getAttribute('type')).toBe('button'); // never submits the form
      expect(icon.getAttribute('aria-label')).toBeTruthy();
      const describedById = icon.getAttribute('aria-describedby');
      expect(describedById).toBeTruthy();
      const tooltip = root.getElementById(describedById as string);
      expect(tooltip?.getAttribute('role')).toBe('tooltip');
    });

    it('the tooltip contains the exact retained-snapshot copy, including the 30-order cap, and is hidden by default', () => {
      const root = mount().shadowRoot as ShadowRoot;
      const tooltip = root.querySelector('.tooltip') as HTMLElement;
      expect(tooltip.hidden).toBe(true);
      expect(tooltip.textContent).toBe(
        'Answers use the current retained order snapshot — up to 30 orders per user, not full order history.'
      );
    });

    it('does not style the tooltip as a warning/error (not the status error color, no role="alert")', () => {
      const root = mount().shadowRoot as ShadowRoot;
      const tooltip = root.querySelector('.tooltip') as HTMLElement;
      expect(tooltip.getAttribute('role')).not.toBe('alert');
      expect(tooltip.className).not.toMatch(/error|warning/i);
      const css = (root.querySelector('style') as HTMLStyleElement).textContent ?? '';
      const tooltipRule = css.slice(css.indexOf('.tooltip {'), css.indexOf('.tooltip {') + 300);
      // #b91c1c is the widget's one error color (.status[data-state='error']) —
      // the tooltip must never use it.
      expect(tooltipRule).not.toMatch(/#b91c1c/);
    });

    it('shows the tooltip on mouse hover and hides it again on mouse leave', () => {
      const root = mount().shadowRoot as ShadowRoot;
      const icon = root.querySelector('.info-icon') as HTMLButtonElement;
      const tooltip = root.querySelector('.tooltip') as HTMLElement;

      icon.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      expect(tooltip.hidden).toBe(false);

      icon.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      expect(tooltip.hidden).toBe(true);
    });

    it('shows the tooltip on keyboard focus and hides it again on blur', () => {
      const root = mount().shadowRoot as ShadowRoot;
      const icon = root.querySelector('.info-icon') as HTMLButtonElement;
      const tooltip = root.querySelector('.tooltip') as HTMLElement;

      icon.dispatchEvent(new FocusEvent('focus'));
      expect(tooltip.hidden).toBe(false);

      icon.dispatchEvent(new FocusEvent('blur'));
      expect(tooltip.hidden).toBe(true);
    });
  });

  describe('suggested prompts', () => {
    function chips(el: BusinessAgentWidget): HTMLButtonElement[] {
      const root = el.shadowRoot as ShadowRoot;
      return Array.from(root.querySelectorAll('button[data-variant="chip"]'));
    }

    function suggestionsBlock(el: BusinessAgentWidget): HTMLElement {
      return (el.shadowRoot as ShadowRoot).querySelector('.suggestions-block') as HTMLElement;
    }

    it('shows exactly 3 suggestion chips while the conversation is empty, and the composer starts empty', () => {
      const el = mount();
      const { input } = shadow(el);
      expect(input.value).toBe('');
      expect(suggestionsBlock(el).hidden).toBe(false);
      expect(chips(el)).toHaveLength(3);
    });

    it('labels the chips as optional, muted, secondary suggestions — not the only supported questions', () => {
      const el = mount();
      const root = el.shadowRoot as ShadowRoot;
      const label = root.querySelector('.suggestions-label');
      expect(label?.textContent).toBe('Suggested questions — or ask anything about the current orders');
      // The label visually/structurally precedes the chips, inside the same
      // wrapper that shows/hides them together.
      const block = suggestionsBlock(el);
      expect(block.contains(label)).toBe(true);
      expect(block.querySelector('.suggestions-label + .suggestions')).not.toBeNull();
      // The chip group's accessible name comes from the visible label, not a
      // second, redundant aria-label.
      const group = root.querySelector('.suggestions') as HTMLElement;
      expect(group.getAttribute('aria-labelledby')).toBe(label?.id);
    });

    it('uses retention-safe example questions, not "who has the most orders"-style questions, and includes the Hebrew suggestion exactly as specified', () => {
      const el = mount();
      const labels = chips(el).map((c) => c.textContent);
      for (const label of labels) {
        expect(label?.toLowerCase()).not.toMatch(/most orders/);
      }
      expect(labels).toEqual([
        'Who has the highest total value across their current orders?',
        'למי יש את סכום ההזמנות הכולל הגבוה ביותר כרגע?',
        'Which users need attention based on recent order activity?',
      ]);
      // Same question as the first chip, asked in a different language — a
      // dedicated assertion since this is the specific portfolio-facing
      // requirement, not just an incidental array-equality check above.
      expect(labels[1]).toBe('למי יש את סכום ההזמנות הכולל הגבוה ביותר כרגע?');
    });

    it('clicking a chip populates the composer, hides suggestions immediately, and submits exactly one request — before the request even resolves', () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, json: async () => ({ answer: 'answer', trace: [], turns: 1 }) });
      vi.stubGlobal('fetch', fetchMock);

      const el = mount();
      const { input } = shadow(el);
      const block = suggestionsBlock(el);
      const chosenChip = chips(el)[0];
      const chosenText = chosenChip.textContent;

      chosenChip.click();

      // All synchronous, deliberately asserted before awaiting anything —
      // this is what "immediately" means: the composer, visibility, and the
      // request itself all happen in the same tick as the click.
      expect(input.value).toBe(chosenText);
      expect(block.hidden).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('submits the clicked chip text verbatim as the prompt, for any chip including the Hebrew one', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, json: async () => ({ answer: 'answer', trace: [], turns: 1 }) });
      vi.stubGlobal('fetch', fetchMock);

      const el = mount();
      const hebrewChip = chips(el)[1];
      const expectedPrompt = hebrewChip.textContent;
      hebrewChip.click();

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const requestBody = JSON.parse(options.body as string);
      expect(requestBody.prompt).toBe(expectedPrompt);
    });

    it('does not allow a second click (another chip, or a duplicate event) to trigger a second request', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, json: async () => ({ answer: 'answer', trace: [], turns: 1 }) });
      vi.stubGlobal('fetch', fetchMock);

      const el = mount();
      const [firstChip, secondChip] = chips(el);
      firstChip.click();
      secondChip.click(); // suggestions are already hidden — must be a no-op
      firstChip.click(); // clicking the same (now-hidden) chip again — also a no-op

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      // Give any delayed second call a tick to show up before asserting it didn't.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('keeps suggestions hidden after a successful suggestion-triggered request', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, json: async () => ({ answer: 'answer', trace: [], turns: 1 }) });
      vi.stubGlobal('fetch', fetchMock);

      const el = mount();
      const block = suggestionsBlock(el);
      chips(el)[0].click();
      expect(block.hidden).toBe(true); // hidden immediately, ahead of the response

      await vi.waitFor(() => expect(transcriptMessages(el)).toHaveLength(2));
      expect(block.hidden).toBe(true); // still hidden — same as today's success behavior
    });

    it('restores suggestions if a suggestion-triggered request fails before a conversation is established', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      const el = mount();
      const block = suggestionsBlock(el);
      const { status } = shadow(el);

      chips(el)[0].click();
      expect(block.hidden).toBe(true); // hidden immediately on click

      await vi.waitFor(() => expect(status.dataset['state']).toBe('error'));
      expect(block.hidden).toBe(false); // restored — no exchange ever succeeded
    });

    it('hides suggestions (chips AND the label) after a manually-typed first exchange succeeds', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ answer: 'answer', trace: [], turns: 1 }) })
      );

      const el = mount();
      const block = suggestionsBlock(el);
      expect(block.hidden).toBe(false);

      await submit(el, 'a question');
      await vi.waitFor(() => expect(block.hidden).toBe(true));
    });

    it('restores suggestions (chips AND the label) on "Start new conversation"', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ answer: 'answer', trace: [], turns: 1 }) })
      );

      const el = mount();
      const { resetButton } = shadow(el);
      const block = suggestionsBlock(el);

      await submit(el, 'a question');
      await vi.waitFor(() => expect(block.hidden).toBe(true));

      resetButton.click();
      expect(block.hidden).toBe(false);
      expect(chips(el)).toHaveLength(3);
      expect((el.shadowRoot as ShadowRoot).querySelector('.suggestions-label')).not.toBeNull();
    });

    it('a failed manually-typed request does not hide suggestions (history stays empty, and they were never hidden to begin with)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      const el = mount();
      const block = suggestionsBlock(el);
      const { status } = shadow(el);

      await submit(el, 'this one fails');
      await vi.waitFor(() => expect(status.dataset['state']).toBe('error'));
      expect(block.hidden).toBe(false);
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
      const { status, button } = shadow(el);

      expect(status.dataset['state']).toBe('loading');
      expect(button.disabled).toBe(true);

      resolveFetch({ ok: true, status: 200, json: async () => ({ answer: 'done', trace: [], turns: 1 }) });
      await vi.waitFor(() => expect(transcriptMessages(el)).toHaveLength(2));
      expect(button.disabled).toBe(false);
      expect(status.dataset['state']).toBeUndefined();
    });

    it('POSTs the prompt and empty history as JSON to the configured endpoint', async () => {
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
        body: JSON.stringify({ prompt: 'How much has Dana spent?', history: [] }),
        signal: expect.any(AbortSignal),
      });
    });

    it('includes the prior exchange as history on the next request', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ answer: 'Dana Levi has spent $238.75.', trace: [], turns: 1 }),
        })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ answer: '2 orders.', trace: [], turns: 1 }) });
      vi.stubGlobal('fetch', fetchMock);

      const el = mount();
      await submit(el, 'How much has Dana spent?');
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      await submit(el, 'And how many orders does she have?');
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

      const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(secondCallBody).toEqual({
        prompt: 'And how many orders does she have?',
        history: [
          { role: 'user', content: 'How much has Dana spent?' },
          { role: 'assistant', content: 'Dana Levi has spent $238.75.' },
        ],
      });
    });

    it('bounds history to the last 3 exchanges (6 messages)', async () => {
      const fetchMock = vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ answer: 'answer', trace: [], turns: 1 }),
      }));
      vi.stubGlobal('fetch', fetchMock);

      const el = mount();
      for (let i = 1; i <= 4; i++) {
        await submit(el, `question ${i}`);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(i));
      }

      await submit(el, 'question 5');
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));

      const fifthCallBody = JSON.parse(fetchMock.mock.calls[4][1].body);
      expect(fifthCallBody.history).toHaveLength(6);
      expect(fifthCallBody.history[0]).toEqual({ role: 'user', content: 'question 2' });
      expect(fifthCallBody.history).not.toContainEqual({ role: 'user', content: 'question 1' });
    });

    it('bounds an over-length answer in the outgoing history instead of dropping the assistant turn', async () => {
      // Claude's own answers can run up to MAX_OUTPUT_TOKENS (tools/business-agent-core.ts,
      // 2048 tokens — comfortably over 2000 characters). The server's own sanitizeHistory()
      // discards (does not truncate) any history entry over MAX_HISTORY_MESSAGE_LENGTH
      // (2000 chars) — so without client-side bounding, a long Answer #1 would silently
      // vanish from the history sent with Ask #2, leaving two consecutive user turns and
      // breaking pronoun/follow-up resolution ("his", "that user") right after the exact
      // kind of detailed answer most likely to need it.
      const longAnswer = 'A'.repeat(3000);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ answer: longAnswer, trace: [], turns: 1 }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ answer: 'follow-up answer', trace: [], turns: 1 }) });
      vi.stubGlobal('fetch', fetchMock);

      const el = mount();
      await submit(el, 'Summarize every order in detail.');
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      // The full, untruncated answer is what the user actually sees.
      expect(transcriptMessages(el)).toEqual([
        { role: 'user', text: 'Summarize every order in detail.' },
        { role: 'assistant', text: longAnswer },
      ]);

      await submit(el, 'What was the highest one?');
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

      const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body) as {
        prompt: string;
        history: { role: string; content: string }[];
      };
      // The assistant turn survives — bounded, not dropped — so the sanitized history
      // stays alternating (user, assistant) instead of two consecutive user turns.
      expect(secondCallBody.history).toHaveLength(2);
      expect(secondCallBody.history[0]).toEqual({ role: 'user', content: 'Summarize every order in detail.' });
      expect(secondCallBody.history[1].role).toBe('assistant');
      expect(secondCallBody.history[1].content.length).toBeLessThanOrEqual(2000);
      expect(longAnswer.startsWith(secondCallBody.history[1].content)).toBe(true);

      // The transcript itself is never touched by request-side bounding — still full.
      expect(transcriptMessages(el)[1]).toEqual({ role: 'assistant', text: longAnswer });
    });

    it('does not pollute history with a failed request', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ answer: 'Dana Levi has spent $238.75.', trace: [], turns: 1 }),
        })
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ answer: 'ok', trace: [], turns: 1 }) });
      vi.stubGlobal('fetch', fetchMock);

      const el = mount();
      await submit(el, 'How much has Dana spent?');
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      await submit(el, 'this one fails');
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

      await submit(el, 'a third question');
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

      const thirdCallBody = JSON.parse(fetchMock.mock.calls[2][1].body);
      expect(thirdCallBody.history).toEqual([
        { role: 'user', content: 'How much has Dana spent?' },
        { role: 'assistant', content: 'Dana Levi has spent $238.75.' },
      ]);
    });

    it('dispatches agent:answer with the expected detail', async () => {
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
      await vi.waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(1));

      expect(onAnswer.mock.calls[0][0].detail).toEqual({
        prompt: 'How much has Dana spent?',
        answer: 'Dana Levi has spent $238.75.',
        trace: [{ name: 'getUserOrders', input: { userId: 2 } }],
        turns: 2,
      });
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
      const { status } = shadow(el);
      await vi.waitFor(() => expect(status.dataset['state']).toBe('error'));

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
      const { status } = shadow(el);
      await vi.waitFor(() => expect(status.dataset['state']).toBe('error'));

      expect(status.textContent).toBe('"prompt" is required');
      expect(onError.mock.calls[0][0].detail).toEqual({ prompt: 'anything', error: '"prompt" is required' });
    });

    it('prefers the human-readable message over the machine-oriented error code when both are present', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 503,
          json: async () => ({ error: 'service_unavailable', message: 'The business agent is temporarily unavailable.' }),
        })
      );

      const el = mount();
      await submit(el, 'anything');
      const { status } = shadow(el);
      await vi.waitFor(() => expect(status.dataset['state']).toBe('error'));

      expect(status.textContent).toBe('The business agent is temporarily unavailable.');
    });

    it('falls back to a generic status-based message when the error body has neither message nor error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));

      const el = mount();
      await submit(el, 'anything');
      const { status } = shadow(el);
      await vi.waitFor(() => expect(status.dataset['state']).toBe('error'));

      expect(status.textContent).toBe('Request failed (500)');
    });

    it('falls back to a generic status-based message when the error response body is not valid JSON (e.g. a platform/firewall HTML page)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 429,
          json: async () => {
            throw new SyntaxError('Unexpected token < in JSON at position 0');
          },
        })
      );

      const el = mount();
      await submit(el, 'anything');
      const { status } = shadow(el);
      await vi.waitFor(() => expect(status.dataset['state']).toBe('error'));

      // Never the raw JSON.parse error text.
      expect(status.textContent).toBe('Request failed (429)');
    });

    it('a successful response still requires the strict {answer, trace, turns} shape even with the safer body parsing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ answer: 'missing trace/turns' }) }));

      const el = mount();
      await submit(el, 'anything');
      const { status } = shadow(el);
      await vi.waitFor(() => expect(status.dataset['state']).toBe('error'));

      expect(status.textContent).toContain('Malformed response');
    });

    it('handles a rejected fetch (real Error) safely', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      const el = mount();
      await submit(el, 'anything');
      const { status } = shadow(el);
      await vi.waitFor(() => expect(status.dataset['state']).toBe('error'));

      expect(status.textContent).toBe('Failed to fetch');
    });

    it('handles a rejected fetch with a non-Error value safely, without crashing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue('connection reset'));

      const el = mount();
      const onError = vi.fn();
      document.addEventListener(BUSINESS_AGENT_ERROR_EVENT, onError);

      await submit(el, 'anything');
      const { status } = shadow(el);
      await vi.waitFor(() => expect(status.dataset['state']).toBe('error'));

      expect(status.textContent).toBe('connection reset');
      expect(onError.mock.calls[0][0].detail.error).toBe('connection reset');
    });
  });

  describe('visible transcript', () => {
    it('shows the user question and the assistant answer after a successful request', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ answer: 'Dana Levi has spent $238.75.', trace: [], turns: 1 }),
        })
      );

      const el = mount();
      await submit(el, 'How much has Dana spent?');
      await vi.waitFor(() => expect(transcriptMessages(el)).toHaveLength(2));

      expect(transcriptMessages(el)).toEqual([
        { role: 'user', text: 'How much has Dana spent?' },
        { role: 'assistant', text: 'Dana Levi has spent $238.75.' },
      ]);
    });

    it('shows both exchanges after a second successful request', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ answer: 'Dana Levi has spent $238.75.', trace: [], turns: 1 }),
        })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ answer: '2 orders.', trace: [], turns: 1 }) });
      vi.stubGlobal('fetch', fetchMock);

      const el = mount();
      await submit(el, 'How much has Dana spent?');
      await vi.waitFor(() => expect(transcriptMessages(el)).toHaveLength(2));

      await submit(el, 'And how many orders does she have?');
      await vi.waitFor(() => expect(transcriptMessages(el)).toHaveLength(4));

      expect(transcriptMessages(el)).toEqual([
        { role: 'user', text: 'How much has Dana spent?' },
        { role: 'assistant', text: 'Dana Levi has spent $238.75.' },
        { role: 'user', text: 'And how many orders does she have?' },
        { role: 'assistant', text: '2 orders.' },
      ]);
    });

    it('rolls the oldest exchange off the visible transcript once history exceeds MAX_HISTORY_MESSAGES', async () => {
      const fetchMock = vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ answer: 'answer', trace: [], turns: 1 }),
      }));
      vi.stubGlobal('fetch', fetchMock);

      const el = mount();
      for (let i = 1; i <= 4; i++) {
        await submit(el, `question ${i}`);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(i));
      }

      const messages = transcriptMessages(el);
      expect(messages).toHaveLength(6);
      expect(messages[0]).toEqual({ role: 'user', text: 'question 2' });
      expect(messages).not.toContainEqual({ role: 'user', text: 'question 1' });
    });

    it('renders message content as text only, never as HTML', async () => {
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
      await vi.waitFor(() => expect(transcriptMessages(el)).toHaveLength(2));

      const { transcript } = shadow(el);
      expect(transcriptMessages(el)[1]).toEqual({ role: 'assistant', text: maliciousAnswer });
      expect(transcript.querySelector('b')).toBeNull();
      expect(transcript.querySelector('img')).toBeNull();
      expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    });

    describe('limited Markdown rendering for assistant answers', () => {
      async function submitAnswer(answer: string): Promise<BusinessAgentWidget> {
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ answer, trace: [], turns: 1 }) })
        );
        const el = mount();
        await submit(el, 'anything');
        await vi.waitFor(() => expect(transcriptMessages(el)).toHaveLength(2));
        return el;
      }

      it('renders **bold**, *italic*, and `code` as real elements, not literal asterisks/backticks', async () => {
        const el = await submitAnswer('The total is **$655.00**, which is *unusually* high — see `getUserOrders`.');
        const { transcript } = shadow(el);
        const assistantBody = transcript.querySelectorAll('.message')[1].querySelector('.message-body') as HTMLElement;
        expect(assistantBody.querySelector('strong')?.textContent).toBe('$655.00');
        expect(assistantBody.querySelector('em')?.textContent).toBe('unusually');
        expect(assistantBody.querySelector('code')?.textContent).toBe('getUserOrders');
        // The flattened text has no leftover markdown syntax characters.
        expect(assistantBody.textContent).toBe('The total is $655.00, which is unusually high — see getUserOrders.');
      });

      it('renders a Markdown list as real <ul><li> elements', async () => {
        const el = await submitAnswer('Top orders:\n- Order #101: $655.00\n- Order #99: $410.00');
        const { transcript } = shadow(el);
        const assistantBody = transcript.querySelectorAll('.message')[1].querySelector('.message-body') as HTMLElement;
        const items = Array.from(assistantBody.querySelectorAll('ul > li'));
        expect(items.map((li) => li.textContent)).toEqual(['Order #101: $655.00', 'Order #99: $410.00']);
      });

      it('does NOT apply Markdown formatting to the user\'s own question', async () => {
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ answer: 'ok', trace: [], turns: 1 }) })
        );
        const el = mount();
        await submit(el, 'Is **this** order high value?');
        await vi.waitFor(() => expect(transcriptMessages(el)).toHaveLength(2));

        const { transcript } = shadow(el);
        const userBody = transcript.querySelectorAll('.message')[0].querySelector('.message-body') as HTMLElement;
        expect(userBody.querySelector('strong')).toBeNull();
        expect(userBody.textContent).toBe('Is **this** order high value?');
      });

      describe('XSS stays inert through the full submit → render path', () => {
        it('a <script> tag in the answer is never parsed into an element', async () => {
          const el = await submitAnswer('<script>window.__pwned = true;</script>');
          const { transcript } = shadow(el);
          expect(transcript.querySelector('script')).toBeNull();
          expect(transcriptMessages(el)[1].text).toBe('<script>window.__pwned = true;</script>');
          expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
        });

        it('an event-handler-attribute payload wrapped in bold markdown is never parsed into an element', async () => {
          const el = await submitAnswer('**<img src=x onerror="window.__pwned = true">**');
          const { transcript } = shadow(el);
          expect(transcript.querySelector('img')).toBeNull();
          expect(transcript.querySelector('[onerror]')).toBeNull();
          const strong = transcript.querySelector('.message-body strong');
          expect(strong?.textContent).toBe('<img src=x onerror="window.__pwned = true">');
          expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
        });

        it('a javascript: URL payload stays inert text — link syntax is not rendered at all', async () => {
          const el = await submitAnswer('[click me](javascript:window.__pwned=true)');
          const { transcript } = shadow(el);
          expect(transcript.querySelector('a')).toBeNull();
          expect(transcriptMessages(el)[1].text).toBe('[click me](javascript:window.__pwned=true)');
          expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
        });

        it('malformed Markdown (unterminated **) renders as literal text, not a broken/open element', async () => {
          const el = await submitAnswer('**this bold is never closed and the rest of the answer follows');
          const { transcript } = shadow(el);
          expect(transcript.querySelector('strong')).toBeNull();
          expect(transcriptMessages(el)[1].text).toBe(
            '**this bold is never closed and the rest of the answer follows'
          );
        });

        it('HTML embedded inside a Markdown list item is never parsed into an element', async () => {
          const el = await submitAnswer('- <b onclick="window.__pwned=true">fake bold</b>');
          const { transcript } = shadow(el);
          expect(transcript.querySelector('b')).toBeNull();
          expect(transcript.querySelector('[onclick]')).toBeNull();
          const li = transcript.querySelector('.message-body li');
          expect(li?.textContent).toBe('<b onclick="window.__pwned=true">fake bold</b>');
          expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
        });
      });
    });

    it('does not add a failed exchange to the transcript, and leaves the input intact', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      const el = mount();
      await submit(el, 'this one fails');
      const { status, input } = shadow(el);
      await vi.waitFor(() => expect(status.dataset['state']).toBe('error'));

      expect(transcriptMessages(el)).toEqual([]);
      expect(input.value).toBe('this one fails');
    });

    it('keeps the composer (form) before the transcript in DOM order, so the transcript grows below it', () => {
      const { form, transcript } = shadow(mount());
      const position = form.compareDocumentPosition(transcript);
      // eslint-disable-next-line no-bitwise
      expect(Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    });

    it('gives the transcript a bounded height and vertical scroll, independent of the page', () => {
      // jsdom doesn't run a real CSS cascade against a <style> tag (only inline
      // `style="..."` attributes are reflected by getComputedStyle), so this reads the
      // widget's own stylesheet text — the same source of truth the browser renders from —
      // rather than asserting on a getComputedStyle value jsdom can't actually produce here.
      const root = mount().shadowRoot as ShadowRoot;
      const css = (root.querySelector('style') as HTMLStyleElement).textContent ?? '';
      const transcriptRule = css.slice(css.indexOf('.transcript {'), css.indexOf('.transcript:empty'));
      expect(transcriptRule).toMatch(/max-height:\s*\S+/);
      expect(transcriptRule).toMatch(/overflow-y:\s*auto/);
    });

    it('appends successive exchanges in chronological order (oldest first, newest last)', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ answer: 'first answer', trace: [], turns: 1 }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ answer: 'second answer', trace: [], turns: 1 }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ answer: 'third answer', trace: [], turns: 1 }) });
      vi.stubGlobal('fetch', fetchMock);

      const el = mount();
      await submit(el, 'first question');
      await vi.waitFor(() => expect(transcriptMessages(el)).toHaveLength(2));
      await submit(el, 'second question');
      await vi.waitFor(() => expect(transcriptMessages(el)).toHaveLength(4));
      await submit(el, 'third question');
      await vi.waitFor(() => expect(transcriptMessages(el)).toHaveLength(6));

      expect(transcriptMessages(el).map((m) => m.text)).toEqual([
        'first question',
        'first answer',
        'second question',
        'second answer',
        'third question',
        'third answer',
      ]);
    });

    it('scrolls the transcript panel itself to the latest exchange after a successful answer', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ answer: 'answer', trace: [], turns: 1 }) })
      );

      const el = mount();
      const { transcript } = shadow(el);
      // jsdom never computes real layout, so scrollHeight is always 0 — stub it to a
      // realistic overflowed value to prove the widget scrolls the panel to match it,
      // not that both happen to be 0.
      Object.defineProperty(transcript, 'scrollHeight', { value: 640, configurable: true });

      await submit(el, 'question');
      await vi.waitFor(() => expect(transcriptMessages(el)).toHaveLength(2));

      expect(transcript.scrollTop).toBe(640);
    });
  });

  describe('auto-clearing the prompt input', () => {
    it('clears the input after a successful request, and still stores the exchange in history', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ answer: 'Dana Levi has spent $238.75.', trace: [], turns: 1 }),
        })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ answer: '2 orders.', trace: [], turns: 1 }) });
      vi.stubGlobal('fetch', fetchMock);

      const el = mount();
      const { input } = shadow(el);
      await submit(el, 'How much has Dana spent?');
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      expect(input.value).toBe('');

      await submit(el, 'And how many orders does she have?');
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

      const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(secondCallBody.history).toEqual([
        { role: 'user', content: 'How much has Dana spent?' },
        { role: 'assistant', content: 'Dana Levi has spent $238.75.' },
      ]);
    });

    it('keeps the original prompt in the input after a failed request', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      const el = mount();
      const { input } = shadow(el);
      await submit(el, 'this one fails');
      await vi.waitFor(() => expect(shadow(el).status.dataset['state']).toBe('error'));

      expect(input.value).toBe('this one fails');
    });
  });

  describe('Start new conversation', () => {
    it('clears history, input, and the visible transcript, so the next request carries no prior history', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ answer: 'Avi Cohen has 6 orders.', trace: [], turns: 1 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ answer: 'His last order was #106.', trace: [], turns: 1 }),
        })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ answer: 'fresh answer', trace: [], turns: 1 }) });
      vi.stubGlobal('fetch', fetchMock);

      const el = mount();
      const { resetButton, input, status } = shadow(el);
      await submit(el, 'How many orders does Avi Cohen have?');
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await submit(el, 'What was his last order?');
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(transcriptMessages(el)).toHaveLength(4));

      resetButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(input.value).toBe('');
      expect(transcriptMessages(el)).toEqual([]);
      expect(status.textContent).toBe('');
      expect(status.dataset['state']).toBeUndefined();
      // Clicking reset alone must not issue any network request.
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await submit(el, 'What was his last order?');
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      const thirdCallBody = JSON.parse(fetchMock.mock.calls[2][1].body);
      expect(thirdCallBody).toEqual({ prompt: 'What was his last order?', history: [] });
    });

    it('does not submit the form when clicked', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const el = mount();
      const { resetButton } = shadow(el);
      resetButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(fetchMock).not.toHaveBeenCalled();
    });

    describe('vs. an in-flight request (race)', () => {
      // Mirrors what a real fetch() does once its AbortSignal fires — the mock
      // never resolves on its own, only rejects when the signal it was given
      // is aborted (by reset, by unmount, or by a newer Ask).
      function abortAwareFetchMock() {
        return vi.fn((_url: string, options?: { signal?: AbortSignal }) => {
          return new Promise<FakeResponse>((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => {
              const err = new Error('The operation was aborted.');
              err.name = 'AbortError';
              reject(err);
            });
          });
        });
      }

      const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

      it('a response that arrives after reset must never reappear in the conversation', async () => {
        let resolveFetch!: (res: FakeResponse) => void;
        vi.stubGlobal('fetch', vi.fn(() => new Promise<FakeResponse>((resolve) => (resolveFetch = resolve))));

        const el = mount();
        const { resetButton } = shadow(el);
        await submit(el, 'How much has Dana spent?');

        resetButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(transcriptMessages(el)).toEqual([]);

        // The stale request "answers" only after the user already reset.
        resolveFetch({ ok: true, status: 200, json: async () => ({ answer: 'stale answer', trace: [], turns: 1 }) });
        await flush();
        await flush();

        expect(transcriptMessages(el)).toEqual([]);
      });

      it('an aborted request (superseded by reset) does not emit agent:error, unlike a real server failure', async () => {
        vi.stubGlobal('fetch', abortAwareFetchMock());
        const errorListener = vi.fn();

        const el = mount();
        el.addEventListener(BUSINESS_AGENT_ERROR_EVENT, errorListener);
        const { resetButton, status } = shadow(el);
        await submit(el, 'How much has Dana spent?');

        resetButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); // aborts the in-flight request
        await flush();
        await flush();

        expect(errorListener).not.toHaveBeenCalled();
        expect(status.dataset['state']).toBeUndefined();
        expect(status.textContent).toBe('');
      });

      it('a new Ask after reset submits and completes normally', async () => {
        const fetchMock = vi.fn();
        fetchMock.mockImplementationOnce(abortAwareFetchMock());
        fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ answer: 'fresh answer', trace: [], turns: 1 }) });
        vi.stubGlobal('fetch', fetchMock);

        const el = mount();
        const { resetButton, button } = shadow(el);
        await submit(el, 'first question');
        expect(button.disabled).toBe(true);

        resetButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(button.disabled).toBe(false); // reset re-enables the button, not just a settled promise

        await submit(el, 'second question');
        await vi.waitFor(() => expect(transcriptMessages(el)).toHaveLength(2));
        expect(transcriptMessages(el)).toEqual([
          { role: 'user', text: 'second question' },
          { role: 'assistant', text: 'fresh answer' },
        ]);
      });

      it('history stays empty after reset until the next request actually completes', async () => {
        let resolveFetch!: (res: FakeResponse) => void;
        const fetchMock = vi.fn(() => new Promise<FakeResponse>((resolve) => (resolveFetch = resolve)));
        vi.stubGlobal('fetch', fetchMock);

        const el = mount();
        const { resetButton } = shadow(el);
        await submit(el, 'first question');

        resetButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(transcriptMessages(el)).toEqual([]);

        await submit(el, 'second question');
        // Still empty while the new request is pending — only its own success populates it.
        expect(transcriptMessages(el)).toEqual([]);
        const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(secondCallBody.history).toEqual([]);

        resolveFetch({ ok: true, status: 200, json: async () => ({ answer: 'answer', trace: [], turns: 1 }) });
        await vi.waitFor(() => expect(transcriptMessages(el)).toHaveLength(2));
      });

      it('unmounting the widget aborts an in-flight request so its late resolution cannot throw or touch a detached element', async () => {
        vi.stubGlobal('fetch', abortAwareFetchMock());
        const el = mount();
        await submit(el, 'How much has Dana spent?');

        expect(() => el.remove()).not.toThrow();
        await flush();
        await flush();
        // No assertion beyond "did not throw" — a detached widget has nothing
        // left to observe, this just proves the abort path is exercised safely.
      });

      it('the Ask button stays disabled while a newer request is still pending, even after a request superseded by reset finishes settling its abort', async () => {
        const fetchMock = vi.fn();
        fetchMock.mockImplementationOnce(abortAwareFetchMock()); // A — rejects once aborted
        let resolveB!: (res: FakeResponse) => void;
        fetchMock.mockImplementationOnce(() => new Promise<FakeResponse>((resolve) => (resolveB = resolve))); // B — resolves manually
        vi.stubGlobal('fetch', fetchMock);

        const el = mount();
        const { resetButton, button } = shadow(el);

        await submit(el, 'first question'); // A pending
        expect(button.disabled).toBe(true);

        resetButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); // aborts A
        await submit(el, 'second question'); // B starts immediately after reset
        expect(button.disabled).toBe(true); // B is now in flight

        // Let A's aborted fetch promise actually settle and run its catch/finally
        // — the exact race: A's finally must not blindly re-enable the button
        // while B is still genuinely pending.
        await flush();
        await flush();
        expect(button.disabled).toBe(true);

        resolveB({ ok: true, status: 200, json: async () => ({ answer: 'B answer', trace: [], turns: 1 }) });
        await vi.waitFor(() => expect(button.disabled).toBe(false));
      });
    });
  });
});
