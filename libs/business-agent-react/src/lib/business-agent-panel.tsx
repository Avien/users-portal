// Phase 3 host integration (see docs/roadmap.md) — deliberately thin. This registers
// and renders the shared <business-agent-widget> as-is: no AI UI reimplementation, no
// LLM orchestration, no business-agent logic here. That all stays server-side
// (tools/business-agent-server.ts) and inside the framework-free widget itself
// (libs/business-agent-widget) — this file only wires it into a React host.
import { useEffect, useRef } from 'react';
import {
  BUSINESS_AGENT_ANSWER_EVENT,
  BUSINESS_AGENT_ERROR_EVENT,
} from '@portal/business-agent-widget';
import type { AgentAnswerEvent, AgentErrorEvent } from '@portal/business-agent-widget';

export function BusinessAgentPanel() {
  const widgetRef = useRef<HTMLElement>(null);

  // Optional host-level reaction, per the roadmap: "use the exported typed event
  // contract where useful, not as a requirement." The widget already renders its
  // own answer/error UI — this only demonstrates the typed contract via logging,
  // not a second UI surface — so it's dev-only, not something to ship to users.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const widget = widgetRef.current;
    if (!widget) return;

    const onAnswer = (event: Event) => {
      console.log('[business-agent] answer', (event as AgentAnswerEvent).detail);
    };
    const onError = (event: Event) => {
      console.error('[business-agent] error', (event as AgentErrorEvent).detail);
    };

    widget.addEventListener(BUSINESS_AGENT_ANSWER_EVENT, onAnswer);
    widget.addEventListener(BUSINESS_AGENT_ERROR_EVENT, onError);
    return () => {
      widget.removeEventListener(BUSINESS_AGENT_ANSWER_EVENT, onAnswer);
      widget.removeEventListener(BUSINESS_AGENT_ERROR_EVENT, onError);
    };
  }, []);

  return (
    <div>
      <h2>Business Agent</h2>
      <business-agent-widget ref={widgetRef} endpoint={import.meta.env['VITE_BUSINESS_AGENT_ENDPOINT']} />
    </div>
  );
}
