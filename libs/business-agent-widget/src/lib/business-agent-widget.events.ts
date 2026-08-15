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

export interface AgentErrorEventDetail {
  prompt: string;
  error: string;
}

export type AgentAnswerEvent = CustomEvent<AgentAnswerEventDetail>;
export type AgentErrorEvent = CustomEvent<AgentErrorEventDetail>;
