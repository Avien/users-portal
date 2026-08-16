// Phase 2 of the Product-Facing Business AI Agent (see docs/roadmap.md).
// A hand-rolled, framework-free Web Component — Shadow DOM, attribute-driven
// config, CustomEvent output. No React/Angular/Vue internals: this is meant to
// be dropped into any of the three apps (or the no-build portal-shell) via a
// plain <script type="module" src="...">. Owns nothing but the prompt input,
// loading/error/result presentation, and the fetch call itself — no business
// logic, no tool definitions, no agent-loop code (that all lives server-side
// in tools/business-agent-server.ts).

import { BUSINESS_AGENT_ANSWER_EVENT, BUSINESS_AGENT_ERROR_EVENT } from './business-agent-widget.events';
import type { AgentAnswerEventDetail, AgentErrorEventDetail } from './business-agent-widget.events';

const TAG_NAME = 'business-agent-widget';
const DEFAULT_ENDPOINT = '/api/business-agent';

type AgentResponse = Omit<AgentAnswerEventDetail, 'prompt'>;

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// Shallow validation of the fields the public event contract promises — no
// per-trace-item validation, no runtime schema library, just what's needed to
// avoid emitting agent:answer with a shape that doesn't match AgentAnswerEventDetail.
function isAgentResponse(body: unknown): body is AgentResponse {
  const candidate = body as Partial<AgentResponse> | null | undefined;
  return (
    typeof candidate?.answer === 'string' &&
    Array.isArray(candidate?.trace) &&
    typeof candidate?.turns === 'number'
  );
}

export class BusinessAgentWidget extends HTMLElement {
  // No attributeChangedCallback — endpoint is read live via the getter below,
  // so there's nothing for observedAttributes to drive.

  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly submitButton: HTMLButtonElement;
  private readonly resultEl: HTMLElement;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { display: block; font-family: system-ui, sans-serif; max-width: 32rem; }
        form { display: flex; gap: 0.5rem; }
        input {
          flex: 1; padding: 0.5rem 0.75rem; border: 1px solid #ccc; border-radius: 6px;
          font: inherit;
        }
        button {
          padding: 0.5rem 1rem; border: none; border-radius: 6px;
          background: #0f766e; color: white; font: inherit; cursor: pointer;
        }
        button:disabled { opacity: 0.6; cursor: default; }
        .result { margin-top: 0.75rem; white-space: pre-wrap; line-height: 1.4; font-size: 0.95rem; }
        .result[data-state='loading'] { color: #6b7280; }
        .result[data-state='error'] { color: #b91c1c; }
      </style>
      <form>
        <input type="text" placeholder="Ask a business question…" aria-label="Business question" required />
        <button type="submit">Ask</button>
      </form>
      <div class="result" role="status"></div>
    `;
    this.form = shadow.querySelector('form') as HTMLFormElement;
    this.input = shadow.querySelector('input') as HTMLInputElement;
    this.submitButton = shadow.querySelector('button') as HTMLButtonElement;
    this.resultEl = shadow.querySelector('.result') as HTMLElement;
  }

  // Read live from the attribute (not cached) — the widget stays in sync if a
  // host app changes it after the element is already connected.
  get endpoint(): string {
    return this.getAttribute('endpoint') || DEFAULT_ENDPOINT;
  }

  // A getter-only accessor breaks host frameworks that configure custom elements
  // via DOM properties rather than attributes (React 19's default; Angular/Vue
  // property bindings too) — `el.endpoint = value` needs a setter to exist at all.
  // Reflects to the attribute so the getter above stays the single source of truth.
  // null/undefined/empty (e.g. an unset Vite env var passed straight through as a
  // prop) removes the attribute rather than setting it to a bad value, so the
  // getter's own DEFAULT_ENDPOINT fallback stays effective.
  set endpoint(value: string | null | undefined) {
    if (value) {
      this.setAttribute('endpoint', value);
    } else {
      this.removeAttribute('endpoint');
    }
  }

  connectedCallback() {
    this.form.addEventListener('submit', this.handleSubmit);
  }

  disconnectedCallback() {
    this.form.removeEventListener('submit', this.handleSubmit);
  }

  private readonly handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    const prompt = this.input.value.trim();
    if (!prompt) return;

    this.submitButton.disabled = true;
    this.resultEl.dataset['state'] = 'loading';
    this.resultEl.textContent = 'Thinking…';

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`);
      }
      if (!isAgentResponse(body)) {
        throw new Error('Malformed response: expected { answer: string, trace: array, turns: number }.');
      }
      this.renderAnswer(body, prompt);
    } catch (err) {
      this.renderError(toErrorMessage(err), prompt);
    } finally {
      this.submitButton.disabled = false;
    }
  };

  private renderAnswer(response: AgentResponse, prompt: string) {
    this.resultEl.dataset['state'] = 'answer';
    this.resultEl.textContent = response.answer;
    this.dispatchEvent(
      new CustomEvent<AgentAnswerEventDetail>(BUSINESS_AGENT_ANSWER_EVENT, {
        detail: { prompt, ...response },
        bubbles: true,
        composed: true,
      })
    );
  }

  private renderError(message: string, prompt: string) {
    this.resultEl.dataset['state'] = 'error';
    this.resultEl.textContent = message;
    this.dispatchEvent(
      new CustomEvent<AgentErrorEventDetail>(BUSINESS_AGENT_ERROR_EVENT, {
        detail: { prompt, error: message },
        bubbles: true,
        composed: true,
      })
    );
  }
}

// Guards against double-registration when multiple bundles land on one page
// (e.g. the Hybrid MFE mounting more than one app that each load this script).
if (!customElements.get(TAG_NAME)) {
  customElements.define(TAG_NAME, BusinessAgentWidget);
}
