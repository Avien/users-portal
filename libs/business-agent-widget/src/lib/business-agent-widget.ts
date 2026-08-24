// Phase 2 of the Product-Facing Business AI Agent (see docs/roadmap.md).
// A hand-rolled, framework-free Web Component — Shadow DOM, attribute-driven
// config, CustomEvent output. No React/Angular/Vue internals: this is meant to
// be dropped into any of the three apps (or the no-build portal-shell) via a
// plain <script type="module" src="...">. Owns nothing but the prompt input,
// loading/error/result presentation, and the fetch call itself — no business
// logic, no tool definitions, no agent-loop code (that all lives server-side
// in tools/business-agent-core.ts, behind the api/business-agent.ts production
// handler and the tools/business-agent-server.ts local dev adapter).

import { BUSINESS_AGENT_ANSWER_EVENT, BUSINESS_AGENT_ERROR_EVENT } from './business-agent-widget.events';
import type { AgentAnswerEventDetail, AgentErrorEventDetail, ConversationMessage } from './business-agent-widget.events';
import { buildSafeMarkdownFragment } from './safe-markdown';

const TAG_NAME = 'business-agent-widget';
const DEFAULT_ENDPOINT = '/api/business-agent';

// Matches the backend's actual retention cap (tools/orders-store.mjs's
// MAX_ORDERS_PER_USER) and the agent's own tool-contract wording
// (tools/business-agent-core.ts) — kept in sync by hand, the same
// independent-duplication rationale as MAX_HISTORY_MESSAGE_LENGTH below (this
// is browser code; that's a Node tool script). Surfaced via the info-icon
// tooltip next to the descriptor (not a permanently visible line — that grew
// the header tall enough to push "Start new conversation" onto its own row),
// so a user who wants the scope of what they're asking can find it on demand.
const RETAINED_ORDERS_PER_USER = 30;

// Concise, meaningful example questions — deliberately NOT "Who has the most
// orders?" or similar: every user eventually reaches the RETAINED_ORDERS_PER_USER
// cap on a long-lived server, at which point "most orders" stops being a
// question the retained snapshot can answer honestly. These three stay
// meaningful regardless of how long the demo server has been running.
//
// One suggestion is deliberately in Hebrew — the same question as the first,
// asked in a different language — so a portfolio visitor sees the agent
// handle multilingual natural-language input immediately, without having to
// think to try it themselves. The agent itself does no language-specific
// handling; this only demonstrates that Claude's own natural-language
// understanding already covers it.
const SUGGESTED_PROMPTS = [
  'Who has the highest total value across their current orders?',
  'למי יש את סכום ההזמנות הכולל הגבוה ביותר כרגע?',
  'Which users need attention based on recent order activity?',
] as const;

// 3 user/assistant exchanges — enough for pronoun/follow-up resolution
// ("his", "she", "that user"), not an attempt at long-term memory. Short-lived,
// in-memory only (not localStorage/sessionStorage) — deliberately lost on
// refresh, per the roadmap's explicit scope for this feature.
const MAX_HISTORY_MESSAGES = 6;

// Same numeric bound as tools/business-agent-core.ts's own MAX_HISTORY_MESSAGE_LENGTH
// — independently duplicated here for the same reason ConversationMessage already is
// (see the import comment above): the widget is browser code, the server is a Node
// tool script, and this value is too small to justify sharing a package across those
// two runtimes.
//
// Claude's own answers can run up to MAX_OUTPUT_TOKENS (2048 tokens — well past 2000
// characters). The server's own sanitizeHistory() DISCARDS (does not truncate) any
// history entry over this length, since it can't safely guess how to shorten
// arbitrary untrusted input — so without bounding what THIS widget sends, a long
// answer would silently vanish from history on the next Ask, breaking multi-turn
// follow-ups ("his", "that user") right after the exact kind of detailed answer most
// likely to need them. Bounding here is safe (unlike the server) because it's this
// widget's own prior answer, not arbitrary third-party input.
const MAX_HISTORY_MESSAGE_LENGTH = 2000;

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

// Prefers the safe, human-readable `message` field over the machine-oriented
// `error` code (e.g. "service_unavailable") — see tools/business-agent-errors.ts's
// SanitizedErrorResponse shape, which always sets both. Falls back to `error`
// only if `message` is missing (an older/different error shape), then to a
// generic status-based message if the body has neither (or isn't JSON at all).
function extractErrorMessage(body: unknown, status: number): string {
  const candidate = body as { message?: unknown; error?: unknown } | null | undefined;
  if (typeof candidate?.message === 'string' && candidate.message.length > 0) return candidate.message;
  if (typeof candidate?.error === 'string' && candidate.error.length > 0) return candidate.error;
  return `Request failed (${status})`;
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

// Bounds what gets SENT as `history` — never what gets rendered. `this.history`
// (the transcript's own source of truth, see renderTranscript) is left untouched;
// this only maps over a copy at request time, truncating any entry over
// MAX_HISTORY_MESSAGE_LENGTH so it survives the server's own sanitizeHistory()
// length check instead of being discarded outright (see that constant's comment
// above). A map (never a filter) — every entry survives, in order, so the
// alternating user/assistant shape sent to the server can never be broken by this
// step, even when the answer it's bounding was very long.
function boundHistoryForRequest(history: ConversationMessage[]): ConversationMessage[] {
  return history.map((message) =>
    message.content.length > MAX_HISTORY_MESSAGE_LENGTH
      ? { ...message, content: message.content.slice(0, MAX_HISTORY_MESSAGE_LENGTH) }
      : message
  );
}

export class BusinessAgentWidget extends HTMLElement {
  // No attributeChangedCallback — endpoint is read live via the getter below,
  // so there's nothing for observedAttributes to drive.

  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly submitButton: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly transcriptEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly suggestionsBlockEl: HTMLElement;
  private readonly infoIconEl: HTMLButtonElement;
  private readonly tooltipEl: HTMLElement;

  // Prior exchanges only — the in-flight prompt is never in here while its own
  // request is pending, only appended after a successful answer. This is the
  // single source of truth for both what gets POSTed as `history` and what the
  // transcript below renders — no separate render-only copy of the conversation.
  private history: ConversationMessage[] = [];

  // Every request currently in flight — plural deliberately: the widget does
  // NOT cancel a request just because a newer Ask started (multiple in-flight
  // Asks resolving independently, each appending to history in resolution
  // order, is normal, pre-existing, already-tested behavior — the submit
  // button being disabled is what normally prevents this via real UI, not
  // this class). Only "Start new conversation" and unmount abort every
  // request tracked here.
  private readonly inFlightControllers = new Set<AbortController>();

  // Incremented ONLY by a reset — NOT by starting a new Ask. Each request
  // captures the generation it started in and checks it again on completion,
  // so a request whose conversation was reset out from under it can never
  // mutate the (new, cleared) history/transcript/status after the fact, even
  // in the narrow window between abort() firing and the fetch promise
  // actually rejecting/resolving.
  private conversationGeneration = 0;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { display: block; font-family: system-ui, sans-serif; max-width: 32rem; }
        .header {
          display: flex; justify-content: space-between; align-items: flex-start;
          gap: 0.75rem; flex-wrap: wrap;
          padding-bottom: 0.75rem; margin-bottom: 0.75rem; border-bottom: 1px solid #e5e7eb;
        }
        h2 { margin: 0 0 0.15rem; font-size: 1.1rem; }
        .descriptor { margin: 0; font-size: 0.8rem; color: #6b7280; position: relative; }
        .info-icon {
          display: inline-flex; align-items: center; justify-content: center;
          width: 1.1rem; height: 1.1rem; padding: 0; margin-left: 0.3rem;
          border: none; border-radius: 999px; background: transparent; color: #9ca3af;
          font-size: 0.85rem; line-height: 1; cursor: help; vertical-align: -0.15em;
        }
        .info-icon:hover, .info-icon:focus-visible { color: #0f766e; }
        .info-icon:focus-visible { outline: 2px solid #0f766e; outline-offset: 1px; }
        /* Dark-on-light neutral tooltip (same convention as native browser title
           tooltips) — deliberately NOT the .status[data-state='error'] red or any
           yellow/orange — this is routine scope information, not a warning. */
        .tooltip {
          position: absolute; z-index: 10; left: 0; top: 100%; margin-top: 0.35rem;
          width: max-content; max-width: 16rem; padding: 0.45rem 0.6rem; border-radius: 6px;
          background: #374151; color: #fff; font-size: 0.72rem; line-height: 1.35; font-weight: 400;
        }
        .tooltip[hidden] { display: none; }
        /* Composer stays above the transcript in both DOM order and layout, so its
           vertical position never moves as the conversation grows — only the bounded,
           independently-scrollable transcript below it grows/scrolls. */
        form { display: flex; flex-wrap: wrap; gap: 0.5rem; }
        input {
          flex: 1 1 12rem; padding: 0.5rem 0.75rem; border: 1px solid #ccc; border-radius: 6px;
          font: inherit;
        }
        button {
          padding: 0.5rem 1rem; border: none; border-radius: 6px;
          background: #0f766e; color: white; font: inherit; cursor: pointer;
        }
        button:disabled { opacity: 0.6; cursor: default; }
        button[data-variant='secondary'] {
          background: transparent; color: #0f766e; border: 1px solid #0f766e;
        }
        .suggestions-block { margin-top: 0.5rem; }
        .suggestions-block[hidden] { display: none; }
        .suggestions-label { margin: 0 0 0.3rem; font-size: 0.75rem; color: #6b7280; }
        .suggestions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
        button[data-variant='chip'] {
          padding: 0.35rem 0.7rem; font-size: 0.85rem; font-weight: 400; border-radius: 999px;
          background: #f0fdfa; color: #0f766e; border: 1px solid #99f6e4;
        }
        button[data-variant='chip']:hover { background: #ccfbf1; }
        .status { margin-top: 0.5rem; white-space: pre-wrap; line-height: 1.4; font-size: 0.95rem; }
        .status:empty { display: none; }
        .status[data-state='loading'] { color: #6b7280; }
        .status[data-state='error'] { color: #b91c1c; }
        .transcript {
          display: flex; flex-direction: column; gap: 0.75rem;
          margin-top: 0.75rem; padding: 0.75rem;
          border: 1px solid #e5e7eb; border-radius: 8px;
          max-height: 16rem; overflow-y: auto;
        }
        .transcript:empty { display: none; border: none; padding: 0; margin-top: 0; }
        .message { margin: 0; }
        .role-label { display: block; font-size: 0.75rem; font-weight: 600; margin-bottom: 0.15rem; }
        .message[data-role='user'] .role-label { color: #0f766e; }
        .message[data-role='assistant'] .role-label { color: #374151; }
        .message-body { margin: 0; white-space: pre-wrap; line-height: 1.4; font-size: 0.95rem; }
      </style>
      <div class="header">
        <div>
          <h2>LLM-Powered Business Agent</h2>
          <p class="descriptor">
            Claude API · Tool calling · Multi-turn context
            <button type="button" class="info-icon" aria-describedby="data-scope-tooltip" aria-label="About this agent's data scope">ⓘ</button>
            <span id="data-scope-tooltip" role="tooltip" class="tooltip" hidden>Answers use the current retained order snapshot — up to ${RETAINED_ORDERS_PER_USER} orders per user, not full order history.</span>
          </p>
        </div>
        <button type="button" class="reset-button" data-variant="secondary" aria-label="Start new conversation">Start new conversation</button>
      </div>
      <form>
        <input type="text" placeholder="Ask a business question…" aria-label="Business question" required />
        <button type="submit">Ask</button>
      </form>
      <div class="suggestions-block">
        <p class="suggestions-label" id="suggestions-label">Suggested questions — or ask anything about the current orders</p>
        <div class="suggestions" role="group" aria-labelledby="suggestions-label">
          ${SUGGESTED_PROMPTS.map((prompt) => `<button type="button" data-variant="chip">${prompt}</button>`).join('')}
        </div>
      </div>
      <div class="status" role="status"></div>
      <div class="transcript" aria-live="polite"></div>
    `;
    this.form = shadow.querySelector('form') as HTMLFormElement;
    this.input = shadow.querySelector('input') as HTMLInputElement;
    this.submitButton = shadow.querySelector('button[type="submit"]') as HTMLButtonElement;
    this.resetButton = shadow.querySelector('.reset-button') as HTMLButtonElement;
    this.transcriptEl = shadow.querySelector('.transcript') as HTMLElement;
    this.statusEl = shadow.querySelector('.status') as HTMLElement;
    this.suggestionsBlockEl = shadow.querySelector('.suggestions-block') as HTMLElement;
    this.infoIconEl = shadow.querySelector('.info-icon') as HTMLButtonElement;
    this.tooltipEl = shadow.querySelector('.tooltip') as HTMLElement;
    // Explicit, not just relying on the template's default (no `hidden`
    // attribute) — this is the same source of truth updateSuggestionsVisibility
    // uses everywhere else, so the initial state can't silently drift from it.
    this.updateSuggestionsVisibility();
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
    this.resetButton.addEventListener('click', this.handleReset);
    // One delegated listener on the wrapper rather than one per chip — the
    // chip set is static (SUGGESTED_PROMPTS never changes at runtime), so
    // there's no dynamic-add/remove case that would need per-button wiring.
    // The label paragraph inside the same wrapper is inert to this listener
    // (handleSuggestionClick only acts on data-variant="chip" targets).
    this.suggestionsBlockEl.addEventListener('click', this.handleSuggestionClick);
    // Hover AND keyboard focus both reveal the tooltip — driven by real JS
    // state (this.tooltipEl.hidden), not a CSS-only :hover/:focus-visible
    // selector, so visibility is deterministic and independently testable.
    this.infoIconEl.addEventListener('mouseenter', this.showTooltip);
    this.infoIconEl.addEventListener('mouseleave', this.hideTooltip);
    this.infoIconEl.addEventListener('focus', this.showTooltip);
    this.infoIconEl.addEventListener('blur', this.hideTooltip);
  }

  disconnectedCallback() {
    this.form.removeEventListener('submit', this.handleSubmit);
    this.resetButton.removeEventListener('click', this.handleReset);
    this.suggestionsBlockEl.removeEventListener('click', this.handleSuggestionClick);
    this.infoIconEl.removeEventListener('mouseenter', this.showTooltip);
    this.infoIconEl.removeEventListener('mouseleave', this.hideTooltip);
    this.infoIconEl.removeEventListener('focus', this.showTooltip);
    this.infoIconEl.removeEventListener('blur', this.hideTooltip);
    // An unmounted widget must not let a still-in-flight request touch it
    // once it (eventually) settles — same reasoning as the reset case below.
    this.abortInFlightRequests();
  }

  private readonly showTooltip = () => {
    this.tooltipEl.hidden = false;
  };

  private readonly hideTooltip = () => {
    this.tooltipEl.hidden = true;
  };

  private abortInFlightRequests() {
    for (const controller of this.inFlightControllers) controller.abort();
    this.inFlightControllers.clear();
  }

  private readonly handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    const prompt = this.input.value.trim();
    if (!prompt) return;

    const controller = new AbortController();
    const generation = this.conversationGeneration;
    this.inFlightControllers.add(controller);

    this.submitButton.disabled = true;
    this.statusEl.dataset['state'] = 'loading';
    this.statusEl.textContent = 'Thinking…';

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, history: boundHistoryForRequest(this.history) }),
        signal: controller.signal,
      });
      // A platform/firewall layer in front of the server (Vercel's own error
      // pages, a WAF block page) can return an HTML/text body instead of JSON
      // on a non-2xx response — this falls through to extractErrorMessage's
      // generic "Request failed (n)" instead of a raw JSON.parse error.
      // Inlined rather than a separate async helper: that adds a microtask
      // tick before `body` is available, which shifts timing callers rely on.
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (!res.ok) {
        throw new Error(extractErrorMessage(body, res.status));
      }
      if (!isAgentResponse(body)) {
        throw new Error('Malformed response: expected { answer: string, trace: array, turns: number }.');
      }
      // "Start new conversation" may have reset the conversation while this
      // request was in flight — a stale response must never mutate a
      // conversation the user already cleared.
      if (this.conversationGeneration !== generation) return;
      this.renderAnswer(body, prompt);
    } catch (err) {
      // Aborted by reset/unmount — not a real server failure, so it must not
      // surface as one (no error UI, no agent:error event).
      if (controller.signal.aborted) return;
      if (this.conversationGeneration !== generation) return;
      this.renderError(toErrorMessage(err), prompt);
    } finally {
      this.inFlightControllers.delete(controller);
      // NOT an unconditional `= false`: if this request was superseded by a
      // reset immediately followed by a new Ask (A pending -> reset -> abort
      // A -> button enabled -> submit B -> button disabled -> A's aborted
      // fetch promise finally settles), A's own finally must not blindly
      // re-enable the button while B is still genuinely in flight — it
      // reflects the actual current in-flight set instead.
      this.updateSubmitButtonDisabledState();
    }
  };

  private updateSubmitButtonDisabledState() {
    this.submitButton.disabled = this.inFlightControllers.size > 0;
  }

  // Populates the composer with the clicked suggestion AND submits it
  // immediately — a suggestion is a shortcut to asking that exact question,
  // not a composer prefill the user still has to notice and press "Ask" on.
  // Submits via form.requestSubmit() (the same path a real Ask/Enter takes,
  // firing the form's own 'submit' event) rather than calling handleSubmit()
  // directly or duplicating any fetch/loading/abort logic here — every
  // existing in-flight/disabled-button/generation/abort protection in
  // handleSubmit applies exactly as it does for a manually typed question.
  private readonly handleSuggestionClick = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || target.dataset['variant'] !== 'chip') return;
    // Already dismissed by an earlier click this tick (a duplicate/stray
    // event, or a second chip somehow still reachable) — a real browser
    // already makes this physically unclickable once hidden, but this makes
    // "no double submission" an explicit code guarantee, not just an
    // incidental consequence of layout.
    if (this.suggestionsBlockEl.hidden) return;
    this.input.value = target.textContent ?? '';
    this.input.focus();
    // Hidden immediately, ahead of the (async) request settling — this is
    // what makes a second click on another chip impossible (the whole block,
    // chips included, leaves the DOM's interactive surface right away) and
    // what "no double submission" actually rests on, together with
    // handleSubmit's own synchronous submitButton.disabled = true. If this
    // request fails while history is still empty, renderError below restores
    // visibility — a failed suggestion-triggered Ask must not strand the user
    // with neither a conversation nor the suggestions that got them here.
    this.suggestionsBlockEl.hidden = true;
    this.form.requestSubmit();
  };

  // Suggestions are a "conversation is empty" affordance (see SUGGESTED_PROMPTS'
  // own comment on why "most orders"-style questions are excluded) — history is
  // already the widget's single source of truth for "is there a conversation
  // yet", so this reuses it rather than tracking a second, parallel boolean that
  // could drift out of sync with reality.
  private updateSuggestionsVisibility() {
    this.suggestionsBlockEl.hidden = this.history.length > 0;
  }

  private renderAnswer(response: AgentResponse, prompt: string) {
    // Only a successful exchange extends history — a failed request never
    // reaches this method, so it can't leave a dangling user turn with no reply.
    const updatedHistory: ConversationMessage[] = [
      ...this.history,
      { role: 'user', content: prompt },
      { role: 'assistant', content: response.answer },
    ];
    this.history = updatedHistory.slice(-MAX_HISTORY_MESSAGES);
    this.renderTranscript();
    this.updateSuggestionsVisibility();
    // Reveal the newest exchange by scrolling the bounded transcript panel itself,
    // not the host page — the composer above it must never move to bring an answer
    // into view.
    this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
    // Only on success — a failed request leaves the prompt in place so the
    // user can retry or edit it instead of retyping from scratch.
    this.input.value = '';
    delete this.statusEl.dataset['state'];
    this.statusEl.textContent = '';
    this.dispatchEvent(
      new CustomEvent<AgentAnswerEventDetail>(BUSINESS_AGENT_ANSWER_EVENT, {
        detail: { prompt, ...response },
        bubbles: true,
        composed: true,
      })
    );
  }

  private renderError(message: string, prompt: string) {
    // History is untouched — a failed exchange never joins the transcript, so
    // it can't be replayed back to Claude as if it were a real prior answer.
    this.statusEl.dataset['state'] = 'error';
    this.statusEl.textContent = message;
    // Re-derives visibility from history (still empty here, since a failure
    // never extends it) rather than unconditionally un-hiding — a no-op for a
    // manually typed question (suggestions were never hidden for that path to
    // begin with), and exactly what restores them after a suggestion-triggered
    // Ask that hid them immediately on click, then failed.
    this.updateSuggestionsVisibility();
    this.dispatchEvent(
      new CustomEvent<AgentErrorEventDetail>(BUSINESS_AGENT_ERROR_EVENT, {
        detail: { prompt, error: message },
        bubbles: true,
        composed: true,
      })
    );
  }

  // Renders `this.history` (the same array sent as `history` in the POST body)
  // as a You/Agent transcript. The assistant's message body goes through
  // buildSafeMarkdownFragment (see safe-markdown.ts) for a small allow-listed
  // set of formatting (bold/italic/code/lists) — that function's own module
  // comment is the authoritative statement of why it's XSS-safe (never
  // innerHTML, never re-parses text as markup; see safe-markdown.spec.ts's
  // XSS suite and this file's own XSS tests). The user's own typed question
  // is left as plain textContent — it's their own input, and there's no
  // reason to reinterpret e.g. a literal "*" they typed as emphasis.
  // No tool trace is rendered here; that stays DEV-console-only in host apps.
  private renderTranscript() {
    this.transcriptEl.replaceChildren(
      ...this.history.map((message) => {
        const row = document.createElement('div');
        row.className = 'message';
        row.dataset['role'] = message.role;
        const label = document.createElement('span');
        label.className = 'role-label';
        label.textContent = message.role === 'user' ? 'You' : 'Agent';
        const body = document.createElement('div');
        body.className = 'message-body';
        if (message.role === 'assistant') {
          body.appendChild(buildSafeMarkdownFragment(message.content));
        } else {
          body.textContent = message.content;
        }
        row.append(label, body);
        return row;
      })
    );
  }

  // Local-only reset: no server call, no effect on canonical Orders/WS state.
  // Bound as a class field (not a prototype method) so add/removeEventListener
  // in connected/disconnectedCallback reference the same function identity.
  private readonly handleReset = () => {
    // Bumping the generation (not just aborting) is what makes an
    // already-settled-but-not-yet-processed response stale too — abort() alone
    // can't undo a response that already arrived.
    this.abortInFlightRequests();
    this.conversationGeneration += 1;
    this.history = [];
    this.renderTranscript();
    this.updateSuggestionsVisibility();
    this.input.value = '';
    // abortInFlightRequests() just cleared the in-flight set, so this is
    // always false here — using the same helper as handleSubmit's finally
    // keeps "is anything in flight" a single source of truth rather than two
    // places independently assuming the set's state.
    this.updateSubmitButtonDisabledState();
    delete this.statusEl.dataset['state'];
    this.statusEl.textContent = '';
  };
}

// Guards against double-registration when multiple bundles land on one page
// (e.g. the Hybrid MFE mounting more than one app that each load this script).
if (!customElements.get(TAG_NAME)) {
  customElements.define(TAG_NAME, BusinessAgentWidget);
}
