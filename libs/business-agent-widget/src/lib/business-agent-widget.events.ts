// Public event contract for <business-agent-widget> — the only thing a host app
// (Angular/React/Vue, Phase 3) needs to know to consume the widget: the event
// names and their detail shapes. Everything else (internal loading/answer/error
// UI state) stays private to the component.

export const BUSINESS_AGENT_ANSWER_EVENT = 'agent:answer' as const;
export const BUSINESS_AGENT_ERROR_EVENT = 'agent:error' as const;

export interface AgentAnswerEventDetail {
  prompt: string;
  answer: string;
  trace: { name: string; input: unknown }[];
  turns: number;
}

// Short-lived multi-turn conversation context the widget sends alongside each
// new prompt (see business-agent-widget.ts) — not part of any event detail,
// but part of the widget's public contract in the same sense: this is the
// shape a host would need to know about if it ever wanted to inspect/clear
// history. Defined independently of the server's own copy of this shape —
// the widget is browser/Custom-Element code, the server is a Node tool
// script, and a 2-field interface is too small to justify sharing a package
// across those two genuinely separate runtimes.
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentErrorEventDetail {
  prompt: string;
  error: string;
}

export type AgentAnswerEvent = CustomEvent<AgentAnswerEventDetail>;
export type AgentErrorEvent = CustomEvent<AgentErrorEventDetail>;
