// Phase 3 host integration (see docs/roadmap.md) — deliberately thin. This registers
// and renders the shared <business-agent-widget> as-is: no AI UI reimplementation, no
// LLM orchestration, no business-agent logic here. That all stays server-side
// (tools/business-agent-server.ts) and inside the framework-free widget itself
// (libs/business-agent-widget) — this file only wires it into an Angular host.
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  InjectionToken,
  OnDestroy,
  ViewChild,
  inject,
  isDevMode
} from '@angular/core';
import '@portal/business-agent-widget';
import { BUSINESS_AGENT_ANSWER_EVENT, BUSINESS_AGENT_ERROR_EVENT } from '@portal/business-agent-widget';
import type { AgentAnswerEvent, AgentErrorEvent } from '@portal/business-agent-widget';

// Angular has no Vite-style build-time env vars — the app provides this the same
// way it already provides ORDERS_SOCKET_URL (see users-angular/data-access), via
// app.config.ts reading its own environment.ts. `undefined` (the default) means
// "no override" — the widget falls back to its own same-origin `/api/business-agent`.
export const BUSINESS_AGENT_ENDPOINT = new InjectionToken<string | undefined>('BUSINESS_AGENT_ENDPOINT', {
  factory: () => undefined
});

@Component({
  selector: 'business-agent-panel',
  standalone: true,
  template: `
    <div class="shell">
      <business-agent-widget #widget [attr.endpoint]="endpoint" />
    </div>
  `,
  // Matches user-orders.component.scss's own .shell (max-width:900px, centered) so
  // the two stack at the same width/left edge — no top padding, since UserOrders'
  // own bottom padding already provides the vertical gap between them.
  styles: [
    `
      .shell {
        max-width: 900px;
        margin: 0 auto;
        padding: 0 2rem 2rem;
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The widget is a plain Custom Element the Angular compiler has no typing for —
  // this is the Angular equivalent of the JSX.IntrinsicElements augmentation the
  // React host adapter needs (see business-agent-widget-elements.d.ts there).
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class BusinessAgentPanelComponent implements AfterViewInit, OnDestroy {
  @ViewChild('widget') private readonly widgetRef!: ElementRef<HTMLElement>;
  protected readonly endpoint = inject(BUSINESS_AGENT_ENDPOINT);

  // Optional host-level reaction, per the roadmap: "use the exported typed event
  // contract where useful, not as a requirement." The widget already renders its
  // own answer/error UI — this only demonstrates the typed contract via logging,
  // not a second UI surface — so it's dev-only, not something to ship to users.
  private readonly onAnswer = (event: Event) => {
    console.log('[business-agent] answer', (event as AgentAnswerEvent).detail);
  };
  private readonly onError = (event: Event) => {
    console.error('[business-agent] error', (event as AgentErrorEvent).detail);
  };

  ngAfterViewInit() {
    if (!isDevMode()) return;
    const widget = this.widgetRef.nativeElement;
    widget.addEventListener(BUSINESS_AGENT_ANSWER_EVENT, this.onAnswer);
    widget.addEventListener(BUSINESS_AGENT_ERROR_EVENT, this.onError);
  }

  ngOnDestroy() {
    if (!isDevMode()) return;
    const widget = this.widgetRef.nativeElement;
    widget.removeEventListener(BUSINESS_AGENT_ANSWER_EVENT, this.onAnswer);
    widget.removeEventListener(BUSINESS_AGENT_ERROR_EVENT, this.onError);
  }
}
