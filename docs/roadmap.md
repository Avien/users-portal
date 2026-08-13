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
Development agent (today):          Business agent (planned):

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

**Example prompts it should eventually handle:**
- "Find users with recent high-value orders or suspicious order bursts and summarize which users need attention."
- "Show me the most important users to review based on their recent order activity and explain why."

**Intended shape** (exact contracts deferred to implementation):

| Concern | Intention |
| :--- | :--- |
| Orchestration | Direct Claude API integration, structured tool/function calling, a multi-step agent loop — same hand-rolled pattern as `tools/agent.mjs`, different tool set |
| Tools | Small, typed, read-only business capabilities (concepts: `searchUsers`, `getUserDetails`, `getUserOrders`, `getOrderMonitoringSignals`) — the LLM selects among them, never gets raw state access |
| Data | Existing mock/in-memory Users/Orders data — no real database or backend required |
| Boundaries | Tools sit behind clean typed contracts, framework-agnostic where practical so both Angular and React UI can consume the same capability; respects the existing Nx layer/framework tags and facade architecture |
| Key handling | The LLM API key stays server-side, behind the smallest viable serverless/API boundary — never called from browser code |
| Separation | LLM/agent orchestration, business tools, and framework-specific UI stay in three distinct layers, mirroring the existing facade discipline |

**Not yet implemented.**

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