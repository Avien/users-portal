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
Development agent (today):          Business agent (Phases 1-2 built):

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

**Example prompts it already handles** (via the Phase 1 server, `POST /api/business-agent`):
- "Find users with recent high-value orders or suspicious order bursts and summarize which users need attention."
- "Show me the most important users to review based on their recent order activity and explain why."

**Shape** (Phases 1-2 implemented; exact detail below reflects the real, shipped contracts, not a plan):

| Concern | Status |
| :--- | :--- |
| Orchestration | ✅ **Implemented** — `tools/business-agent-server.ts`, direct Claude API integration, structured tool/function calling, a multi-step agent loop (same hand-rolled pattern as `tools/agent.mjs`, different tool set) |
| Tools | ✅ **Implemented** — 3 typed, read-only tools (`searchUsers`, `getUserOrders`, `getOrderMonitoringSignals`), thin wrappers reusing existing `@portal/users/utils` logic; the LLM selects among them, never gets raw state access |
| Data | ✅ Existing mock/in-memory Users/Orders data — no real database or backend required |
| UI delivery | ✅ **Implemented** — `libs/business-agent-widget`, a single hand-rolled, framework-free **`<business-agent-widget>`** Web Component (Shadow DOM, attribute-driven `endpoint` config, `CustomEvent` output), built once as a real Vite lib-mode bundle. Mirrors `<auth-login-widget>` below; this is a cross-cutting capability, not a domain feature the repo is trying to compare idiomatically across frameworks |
| Public event contract | ✅ **Implemented** — `BUSINESS_AGENT_ANSWER_EVENT` / `BUSINESS_AGENT_ERROR_EVENT` constants + typed `AgentAnswerEventDetail`/`AgentErrorEventDetail`, exported from the lib's public `index.ts` |
| Key handling | ✅ **Implemented** — the Claude API key stays server-side in `tools/business-agent-server.ts`, never called from browser code |
| Separation | ✅ **Implemented** — LLM/agent orchestration, business tools, and the widget's UI stay in distinct layers; the widget only fetches + renders, no business logic in the browser |
| Framework wiring | ❌ **Not yet implemented (Phase 3)** — the widget isn't dropped into Angular, React, or Vue yet; each host app would only need a thin `<script src>` + a couple of `CustomEvent` listeners, no facade reimplementation |

**Not yet reachable from any app** — Phases 1 and 2 are real, tested, merged code (server + widget), but until Phase 3 wires the widget into at least one app, there's no way for an end user to actually use it.

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