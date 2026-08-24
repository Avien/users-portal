<!--
  Phase 3 host integration (see docs/roadmap.md) — deliberately thin. This registers
  and renders the shared <business-agent-widget> as-is: no AI UI reimplementation, no
  LLM orchestration, no business-agent logic here. That all stays server-side
  (tools/business-agent-core.ts, behind api/business-agent.ts in production) and inside
  the framework-free widget itself (libs/business-agent-widget) — this file only wires
  it into a Vue host.
-->
<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef } from 'vue';
import '@portal/business-agent-widget';
import { BUSINESS_AGENT_ANSWER_EVENT, BUSINESS_AGENT_ERROR_EVENT } from '@portal/business-agent-widget';
import type { AgentAnswerEvent, AgentErrorEvent } from '@portal/business-agent-widget';

// Same VITE_BUSINESS_AGENT_ENDPOINT convention as the React host adapter
// (libs/business-agent-react) — both apps are Vite-built. Unset means the widget
// falls back to its own same-origin `/api/business-agent` default.
const endpoint = import.meta.env['VITE_BUSINESS_AGENT_ENDPOINT'] as string | undefined;

const widgetRef = useTemplateRef<HTMLElement>('widget');

// Optional host-level reaction, per the roadmap: "use the exported typed event
// contract where useful, not as a requirement." The widget already renders its
// own answer/error UI — this only demonstrates the typed contract via logging,
// not a second UI surface — so it's dev-only, not something to ship to users.
function onAnswer(event: Event) {
  console.log('[business-agent] answer', (event as AgentAnswerEvent).detail);
}
function onError(event: Event) {
  console.error('[business-agent] error', (event as AgentErrorEvent).detail);
}

onMounted(() => {
  if (!import.meta.env.DEV) return;
  const widget = widgetRef.value;
  if (!widget) return;
  widget.addEventListener(BUSINESS_AGENT_ANSWER_EVENT, onAnswer);
  widget.addEventListener(BUSINESS_AGENT_ERROR_EVENT, onError);
});
onUnmounted(() => {
  if (!import.meta.env.DEV) return;
  const widget = widgetRef.value;
  if (!widget) return;
  widget.removeEventListener(BUSINESS_AGENT_ANSWER_EVENT, onAnswer);
  widget.removeEventListener(BUSINESS_AGENT_ERROR_EVENT, onError);
});
</script>

<template>
  <div class="shell">
    <business-agent-widget ref="widget" :endpoint="endpoint" />
  </div>
</template>

<style scoped>
/* Matches UserOrders.vue's own .shell (max-width:900px, centered) so the two
   stack at the same width/left edge — no top padding, since UserOrders' own
   bottom padding already provides the vertical gap between them. */
.shell {
  max-width: 900px;
  margin: 0 auto;
  padding: 0 2rem 2rem;
}
</style>
