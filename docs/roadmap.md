# Users Portal — Project Roadmap

This tracks planned product and architecture direction, kept separate from
the deep-dive docs (which document what's already built and verified).
Every item below is explicitly tagged **Planned**, **Experimental /
undecided**, listed under **Post-production / Portfolio Polish**, or listed
under **Completed** — nothing here should be read as already shipped unless
marked so.

## Planned

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

## Post-production / Portfolio Polish

The Business Agent's underlying architecture is shipped and
production-verified (see **Completed** below). Everything in this section is
presentation, documentation, or portfolio-reviewer-experience improvement
only — none of it touches the canonical store, the agent loop, or any
framework's data layer. Listed here (not under **Planned**) specifically to
keep "still-being-architected" work visually separate from "already-shipped,
being polished" work.

### Live WebSocket order visual feedback

- Subtle, temporary glow/pulse on a newly inserted order row
- A small "+1" / indicator badge on another user's (unselected) tab when an
  order arrives for them while that tab isn't the active selection
- Optional small "Live updates connected" indicator near the orders list
- Ephemeral **presentation** state only (e.g. a short-lived CSS class or
  local component state keyed by order id) — explicitly not a field added to
  the `Order` domain model or any shared contract in `@portal/users/utils`

### Business Agent semantics clarity

The core facts (agent answers over the current retained dataset only,
evicted orders are gone not archived) are now documented — see
[docs/business-agent.md](./business-agent.md#what-the-agent-can-see). What's
still open:
- Surface the same "current dataset only" framing in-product, not just in
  docs — e.g. the widget's own copy/placeholder text, so an end user (not
  just a doc reader) never mistakes an answer for full lifetime history
- A repo-wide audit (README, other deep-dive docs) for any remaining
  language that could imply "full history"
- **Agent-facing semantics, not just documentation** — the system
  prompt/tool contract (`tools/business-agent-core.ts`) doesn't currently
  tell Claude that evicted orders once existed, so the agent isn't
  guaranteed to volunteer the retention limitation when a question implies
  full history (e.g. "first order ever") rather than just answering from
  whatever the tools returned. Not done in Tier 1 — no agent code changed;
  see [docs/business-agent.md § What the agent can see](./business-agent.md#what-the-agent-can-see)
  for the current, honestly-scoped claim (architectural guarantee only, not
  a behavioral one).

### Business Agent UX polish

- Clickable suggested-prompt chips (the example prompts already documented
  in [docs/business-agent.md](./business-agent.md)) — the composer input
  itself stays empty by default; clicking a suggestion fills it in without
  auto-submitting
- Safe, limited Markdown rendering for Claude's answer text (bold/italic/
  lists/code spans) in place of the current plain-text-only transcript —
  must preserve the widget's existing XSS-safety guarantee (no `innerHTML`
  of raw provider text; a sanitizing renderer or an allow-listed manual
  parser, not a raw HTML string)

### Documentation accuracy

Done in [docs/business-agent.md](./business-agent.md#demo-scale-simplifications):
order ids are opaque / `order.userId` is authoritative, per-user FIFO
retention capped at 30, server-side/in-memory/process-local state, a
Railway restart resets all demo data, and the shared-across-visitors nature
of the live demo. What's still open: cross-check the same claims read
consistently in the README and any other deep-dive doc that touches
Orders/retention, rather than living correctly in only one place.

### Portfolio / reviewer README polish

- A "For reviewers — start here" quick-tour section near the top of the README
- A claim-to-code/test evidence table (each README claim linked to the
  file/test that backs it)
- CI/status badges (build, the validate jobs, the architecture-review gate)
- A short "architecture decisions & trade-offs" summary (linking to existing
  deep-dive docs rather than duplicating them)
- An explicit "intentional limitations" list (demo-scale retention, no
  persistence, no auth yet, etc.)
- Appropriate GitHub repo topics (e.g. `nx-monorepo`, `angular`, `react`,
  `vue`, `microfrontends`, `claude-api`, `llm-tool-use`)

### Operational polish

Done — the Anthropic billing/rate-limit safeguards already in place (Vercel
Firewall rate limiting, `MAX_TURNS`, output-token cap, whole-request
timeout, bounded SDK retries, request-body/prompt/history size caps) are
now consolidated in one reviewer-facing table:
[docs/business-agent.md § Cost & rate-limit safeguards](./business-agent.md#cost--rate-limit-safeguards).

**Explicitly out of scope for this pass:** a persistent database,
Redis/multi-instance architecture, a WS reconnect/resync redesign (tracked
separately under Engineering Improvements above), broad Vue cleanup, moving
the production agent modules out of `tools/` (see CLAUDE.md's documented
exception for why they live there), and a PR-review-bot redesign.

## Completed

A few previously-planned items that have since shipped, kept here for
continuity rather than duplicated in full:

- **Product-Facing Business AI Agent** — Claude-powered
  `<business-agent-widget>` Web Component answering natural-language
  questions over live Users/Orders data via structured tool calling, shared
  verbatim across Angular/React/Vue. Delivered in five phases (engine →
  shared widget → host integration → production deploy → docs/demo
  closeout); production `/api/business-agent` is deployed on Vercel against
  the canonical Orders backend on Railway, merged via #12 and smoke-tested
  against production across all four apps (Angular, React, Vue, Hybrid MFE).
  See [docs/business-agent.md](./business-agent.md) for the full
  architecture and deployment write-up.
- **Vue 3 standalone implementation** — a third parallel framework rebuild
  of the same Users/Orders domain (alongside Angular and React), merged to
  `main` and deployed independently to Vercel, production-configured and
  production smoke-tested. Standalone only — not a Hybrid MFE host or
  remote; the Hybrid MFE composition remains Angular host + React remote
  (see Multi-Framework / MFE Evolution above for the still-planned "Vue as a
  third Hybrid MFE remote" work).
- **PR review agent as an enforced gate** — went from a planned idea to a
  required CI status check with branch protection on `main`; see
  [Agentic AI Development](./agentic-workflow.md) for the full design.