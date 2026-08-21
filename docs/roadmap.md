# Users Portal — Project Roadmap

This tracks planned product and architecture direction, kept separate from
the deep-dive docs (which document what's already built and verified).
Every item below is explicitly tagged **Planned**, **Experimental /
undecided**, or listed under **Completed** — nothing here should be read as
already shipped unless marked so.

## Planned

### Product-Facing Business AI Agent

The repository already demonstrates two *development*-facing AI use cases —
autonomous feature scaffolding (`tools/agent.mjs`) and architecture
enforcement (`tools/pr-review-agent.mjs`), see
[Agentic AI Development](./agentic-workflow.md). The natural next step is
applying the same LLM + tool-calling pattern to the *product* itself: a
business-domain agent that answers natural-language questions over the
existing Users/Orders data.

```text
Development agent (today):          Business agent:

Developer goal                      User question
    ↓                                    ↓
LLM                                  LLM
    ↓                                    ↓
read_file / edit_file /             searchUsers / getUserOrders /
scaffold_domain / run_validation    getOrderMonitoringSignals
                                         ↓
                                     LLM combines results
                                         ↓
                                     Business-oriented answer
```

**Example prompts already working end-to-end via the Phase 1 server:**
- "Find users with recent high-value orders and summarize which users need attention."
- "Show me the most important users to review based on their recent order activity and explain why."

*(Burst-order detection — multiple orders for the same user in a short
window — is out of scope for Phase 1: the static mock dataset the tools
read from has no order-arrival timestamps. It would need the live WS
stream's data, not this REST mock data, so it stays out of scope unless
timestamped/live-stream data is added.)*

#### Phase 1 — Business Agent Engine ✅ Implemented

- Direct Claude API integration, structured tool/function calling, a
  multi-step tool-use loop (same hand-rolled pattern as `tools/agent.mjs`)
- 3 typed, read-only business tools (`searchUsers`, `getUserOrders`,
  `getOrderMonitoringSignals`), thin wrappers reusing existing
  `@portal/users/utils` logic — no reimplemented domain logic
- Local `POST /api/business-agent` (`tools/business-agent-server.ts`)
- Tests covering the tools and the orchestration loop

#### Phase 2 — Shared Web Component ✅ Implemented

- Framework-free **`<business-agent-widget>`** (`libs/business-agent-widget`)
  — Shadow DOM, configurable `endpoint` attribute, loading/error/answer
  states, built once as a real Vite lib-mode bundle
- Typed public `CustomEvent` contract (`BUSINESS_AGENT_ANSWER_EVENT` /
  `BUSINESS_AGENT_ERROR_EVENT` + detail interfaces), exported from the
  lib's public `index.ts`
- Tests covering the widget's behavior and contract

#### Phase 3 — Host Integration ✅ Implemented

The same `<business-agent-widget>` gets dropped into all three apps, not
reimplemented per framework — this is exactly what the Phase 2 Web
Component pivot exists to avoid.

```text
Angular ─┐
React   ─┼── <business-agent-widget>
Vue     ─┘
```

Each host app should:
- load/register the shared Web Component
- render the same `<business-agent-widget>` — no per-framework AI UI
- use the exported typed event contract where host-level integration is
  useful (e.g. reacting to an answer), not as a requirement
- avoid a framework-specific Business Agent facade unless there's a
  genuine framework-state requirement — the widget owns its own state
- contain no LLM orchestration or business-agent logic — that stays
  server-side, unchanged from Phase 1

#### Phase 4 — Production API / Deployment ⬜ Not yet implemented

`tools/business-agent-server.ts` is a Phase 1 development/proof server
(`node:http` on `localhost:8787`), not the final deployed backend.

```text
POST /api/business-agent
        ↓
server-side/serverless handler
        ↓
existing Business Agent orchestration
        ↓
Claude API
        ↓
business tools
```

- `ANTHROPIC_API_KEY` remains server-side only
- Reuses the existing `runAgent`, tool definitions, and dispatch/tool-loop
  logic as-is — no duplicated agent implementation for deployment
- The smallest serverless/API boundary compatible with the project's
  current deployment architecture
- The deployed widget uses its default same-origin `/api/business-agent`;
  the configurable `endpoint` attribute stays useful for local dev only
- The permissive `Access-Control-Allow-Origin: *` added for local dev is
  explicitly a dev-only concern, not the production architecture
- Verified from the actually deployed application, not only `localhost`

#### Phase 5 — Documentation / Demo Closeout ⬜ Not yet implemented

- Move this roadmap item from in-progress to **Completed**
- Update [Agentic AI Development](./agentic-workflow.md) to clearly
  distinguish all four AI surfaces in this repo: the Claude Code /
  agentic development workflow, the autonomous development agent
  (`tools/agent.mjs`), the PR review agent (`tools/pr-review-agent.mjs`),
  and the product-facing Business Agent
- Update the README only where it improves portfolio discoverability
- Document one or two real example prompts with their actual tool traces
- Verify the finished feature from the deployed apps

```text
Phase 1  Business Agent engine                      ✅
Phase 2  Shared Web Component                       ✅
Phase 3  Angular / React / Vue host integration      ✅
Phase 4  Real deployed /api/business-agent endpoint  ⬜
Phase 5  Docs + live-demo closeout                   ⬜
```

**Not complete until Phase 5** — Phase 3 alone (host integration against
the local dev server) is not a shipped feature; Phase 4 (real deployment)
and Phase 5 (closeout) are required before this item moves to Completed.

### Authentication & Platform

Three tied pieces of planned auth work, sequenced together because they only
pay off as a set — a login screen in front of already-public data isn't
worth building on its own.

- **`<auth-login-widget>`** — a hand-rolled, framework-free Web Component
  (Shadow DOM, attribute-driven config, `CustomEvent` output) rather than a
  React-wrapped component. Distributed as its own small package so even the
  no-build `portal-shell` can drop it in with a plain `<script src>`.
- **`PlatformSDK.auth`** — a real access/refresh JWT flow: short-lived
  access token held in memory only, refresh token via an `HttpOnly` cookie,
  silent refresh on 401. Backed by new `/auth/login`, `/auth/refresh`,
  `/auth/logout` endpoints on the existing Railway server, issued against a
  small fake user list (real token mechanics, mock user data).
- **Login-gated data fetching** — the Users/Orders fetch currently fires
  unconditionally on mount in all three frameworks; this gates it behind
  `PlatformSDK.auth.isAuthenticated`, consumed identically by Angular,
  React, and (if built) Vue, working both standalone and as MFE remotes.

**Not yet implemented.**

### Multi-Framework / MFE Evolution

- **Vue as a third Hybrid MFE remote** — extending the existing
  Angular-hosted Hybrid mode (today: Angular host + React remote) so Vue
  can mount alongside React as a second, simultaneous remote under the same
  `@portal/platform` contract (`MountMfe`, `PlatformSDK`, typed `EventBus`).
- **Cross-MFE state sync** — using the existing `EventBus` to keep
  state like the selected user consistent across simultaneously mounted
  remotes, rather than treating each remote as fully independent.
- **Framework-agnostic contract growth** — keeping `@portal/platform`
  shaped so any future remote (Vue or otherwise) can join through the same
  seam without new host-specific concepts.

> **Experimental / undecided:** two alternative integration shapes were
> considered and explicitly declined in favor of the above — Vue acting as
> a *host* for React, and the shell hosting Vue *directly* rather than
> through the Angular host. Recorded here for context, not as live options.

### Engineering Improvements

#### Runtime / WebSocket Resilience

- **Duplicate-connection dedup** — when more than one MFE remote is
  mounted at once (e.g. the Hybrid MFE evolution above), each currently
  opens its own WebSocket independently.
- **Reference-counted connection singleton** — one shared socket per page
  regardless of how many consumers (remotes, or React StrictMode's double
  effect) request it.
- **Reconnect with dedup** — automatic reconnection with per-connection
  monitoring-state reset, so a dropped connection doesn't double-count
  order-burst detection on resume.

## Completed

A few previously-planned items that have since shipped, kept here for
continuity rather than duplicated in full:

- **Vue 3 standalone implementation** — a third parallel framework rebuild
  of the same Users/Orders domain (alongside Angular and React), deployed
  independently to Vercel.
- **PR review agent as an enforced gate** — went from a planned idea to a
  required CI status check with branch protection on `main`; see
  [Agentic AI Development](./agentic-workflow.md) for the full design.