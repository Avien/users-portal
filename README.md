
# 👥 Users Portal

This repository explores how the same frontend domain can evolve across:

- Angular standalone reference architecture
- Idiomatic React and Vue standalone architectures
- Shared framework-agnostic domain contracts with Nx-enforced boundaries
- Real-time WebSocket updates over one canonical Orders backend
- Hybrid Angular-host / React-remote Microfrontend composition with Module Federation 2.0
- Product-facing LLM Business Agent with Claude API tool calling and multi-turn context
- Agentic AI workflows for cross-framework architecture, implementation, and automated review

> The goal is not direct framework translation, but understanding how the same architectural responsibilities map differently across rendering and state paradigms.
> 
**🚀 Live Demo**

<a href="https://users-portal-shell.vercel.app">
  <img src="https://img.shields.io/badge/🧩%20Hybrid%20MFE-0f766e?style=for-the-badge" />
</a>

<a href="https://users-portal-angular.vercel.app">
  <img src="https://img.shields.io/badge/-Angular-DD0031?style=for-the-badge&logo=angular&logoColor=white" />
</a>

<a href="https://users-portal-react.vercel.app">
  <img src="https://img.shields.io/badge/-React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" />
</a>

<a href="https://users-portal-vue.vercel.app">
  <img src="https://img.shields.io/badge/-Vue-4FC08D?style=for-the-badge&logo=vue.js&logoColor=white" />
</a>

<a href="https://github.com/Avien/users-portal/actions/workflows/ci.yml">
  <img src="https://github.com/Avien/users-portal/actions/workflows/ci.yml/badge.svg" />
</a>

<a href="https://github.com/Avien/users-portal/actions/workflows/pr-review.yml">
  <img src="https://github.com/Avien/users-portal/actions/workflows/pr-review.yml/badge.svg" />
</a>

## 🧭 For Reviewers — Start Here

A concise entry point for a Staff/Principal-level reviewer — what this repo demonstrates, and where the evidence actually lives. Quick tour:

1. [Architecture at a Glance](#-architecture-at-a-glance) — the same VM/interactions contract, three framework-native implementations
2. [Canonical Orders Store](#-canonical-orders-store) + [LLM-Powered Business Agent](docs/business-agent.md) — a real Claude tool-calling loop over live state, not a chatbot wrapper
3. [Hybrid Microfrontend Architecture](docs/mfe-architecture.md) — Module Federation 2.0, a framework-agnostic `mount()` contract, zero React imports in the host
4. [Agentic AI Development](docs/agentic-workflow.md) — how this repo itself is built: guardrails encoded in `CLAUDE.md` and enforced by tooling ([`eslint.config.mjs`](eslint.config.mjs)'s tag rules, generators, slash commands, an automated PR reviewer), not just stated as convention

| Claim | Implementation | Evidence |
| :--- | :--- | :--- |
| Same VM/interactions contract, 3 framework-native facades | [`users-facade.interactions.ts`](libs/users/src/lib/models/users-facade.interactions.ts), [`user-orders.vm.ts`](libs/users/src/lib/models/user-orders.vm.ts) | [Architecture at a Glance](#-architecture-at-a-glance) |
| Module boundaries enforced by tooling, not convention | [`eslint.config.mjs`](eslint.config.mjs) | [`CLAUDE.md`](CLAUDE.md) — Module Boundary Tags |
| Real-time updates share one canonical store | [`tools/mock-orders-ws-server.mjs`](tools/mock-orders-ws-server.mjs) | [docs/business-agent.md § Source-of-truth model](docs/business-agent.md#source-of-truth-model) |
| Angular host has zero React imports — integrates the remote through a framework-agnostic `mount()` contract | [`react-wrapper.component.ts`](apps/users-portal-angular/src/app/react-wrapper/react-wrapper.component.ts) | [docs/mfe-architecture.md § Angular host](docs/mfe-architecture.md#angular-host--framework-agnostic-wrapper) |
| Real structured tool calling, not prompt stuffing | [`tools/business-agent-core.ts`](tools/business-agent-core.ts) | [`tools/business-agent-core.spec.ts`](tools/business-agent-core.spec.ts) |
| Framework-neutral Business Agent UI — one shared Web Component, thin per-framework adapters | [`business-agent-widget.ts`](libs/business-agent-widget/src/lib/business-agent-widget.ts) | [docs/business-agent.md § Cross-framework integration](docs/business-agent.md#cross-framework-integration) |
| Architecture drift checked automatically on every PR | [`tools/pr-review-agent.mjs`](tools/pr-review-agent.mjs) | [`.github/workflows/pr-review.yml`](.github/workflows/pr-review.yml) |
| CI validates all 3 frameworks + the agent backend independently | [`package.json`](package.json) `validate:*` scripts | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |

## 📦 Project Overview

This Nx monorepo contains Angular, React, and Vue standalone implementations of the same users-and-orders domain, plus a Hybrid MFE mode where Angular hosts the React remote through Module Federation 2.0. Each standalone app is deployed independently to Vercel while all three consume the same live canonical Orders backend.

| App | Stack | Purpose |
| :--- | :--- | :--- |
| `apps/portal-shell` | Vanilla JS, no build step | Landing page — mode selector, redirects to any app |
| `apps/users-portal-angular` | Angular 21, NgRx, Signals, OnPush | Reference implementation + Hybrid MFE host |
| `apps/users-portal-react` | React 19, TanStack Query, Zustand, Vite | Idiomatic React rebuild + MFE remote |
| `apps/users-portal-vue` | Vue 3, TanStack Query, Pinia, Vite | Third parallel framework rebuild, standalone deploy |

The UI lists users and their orders. Selecting a user loads orders lazily with per-user caching; a WebSocket stream pushes live updates merged into the cache without overwriting lazily loaded data; high-value and burst orders trigger auto-dismissing toast notifications.

## 🔔 Order Monitoring Notifications

- **Warning** — a newly streamed order crosses the high-value threshold (`>= $500`)
- **Critical** — the same user receives multiple new streamed orders within a 2-minute burst window
- **Noise control** — bulk API hydration is ignored to avoid toast spam; only streamed events trigger toasts
- Pure detection logic (`reduceOrderMonitoring`) lives in the shared `@portal/users/utils` lib — all three facades run the same rule, wiring it to their own state layer (NgRx effect / Zustand action / Pinia action)

**Try it locally:**
```bash
npm run mock:ws && npm run start:react
```
A fresh viewing session — a 0→1 transition in connected WebSocket clients — starts a short 3-order demo burst when no previous burst is still in flight: the first establishes the monitoring baseline, the second triggers a high-value warning, and the third triggers a critical burst notification. Recurring order generation runs on one process-level scheduler and only emits while at least one client is connected — at zero clients the timer keeps ticking but each tick is a no-op (no order allocated, no store mutation). Additional clients joining an already-active session don't trigger another burst, and a burst already in progress is allowed to finish even if its triggering client disconnects — which is also what keeps a rapid disconnect/reconnect from starting a second, overlapping burst.

## 🗄️ Canonical Orders Store

Every reader of Orders data — each frontend's initial load, the WebSocket stream, and the [Business Agent](docs/business-agent.md) — reads from the **same** live server-side state, not a static snapshot frozen at process start:

```text
                       Canonical Orders Store
                               │
             ┌─────────────────┼──────────────────┐
             │                 │                   │
       GET /api/orders    WS /orders     GET /api/orders-snapshot
             │                 │                   │
             ↓                 ↓                   ↓
        frontend          cache updates       Business Agent
       initial load                        (orders + arrival metadata)
```

`tools/mock-orders-ws-server.mjs` owns one canonical in-memory Orders store shared by all clients. Frontends hydrate from `GET /api/orders`, receive live deltas over `WS /orders`, and the Business Agent reads `GET /api/orders-snapshot` from that same state — keeping the UI and agent aligned.

The store retains the latest 30 orders per user. New orders evict the oldest ones, so REST, WebSocket clients, and the Business Agent all converge on the same bounded current dataset.

## 🤖 LLM-Powered Business Agent

A Claude-powered agent that answers natural-language questions over live Users/Orders data via structured tool calling — not a chatbot wrapper, an actual `model → tool → result → model` loop reading the same canonical backend state the UI does.

- Bounded multi-turn conversational context — follow-up questions resolve pronouns/references from the visible transcript
- One framework-independent `<business-agent-widget>` Web Component (Shadow DOM), shared verbatim by all three standalone apps (Angular, React, Vue) and by the Hybrid MFE composition (Angular host + React remote)
- The UI and Business Agent derive from the same canonical backend state, minimizing source-of-truth drift: frontends use HTTP snapshot + WS deltas, while the agent takes a fresh canonical snapshot for each request
- Server-side-only Vercel API — `ANTHROPIC_API_KEY` never reaches the browser, rate-limited and sanitized at the production boundary

→ Full architecture, agent loop, and deployment details: **[docs/business-agent.md](docs/business-agent.md)**

## ⚖️ Architecture at a Glance

Same domain, one shared `UserOrdersVm & IUsersFacadeInteractions` contract exposed idiomatically in each framework — idiomatic internals otherwise:

| Concern | Angular | React | Vue |
| :--- | :--- | :--- | :--- |
| Server/domain state | NgRx + NgRx Entity (normalized, effects) | TanStack Query (`staleTime: Infinity` — WS is the sole freshness signal) | TanStack Vue Query (`staleTime: Infinity` — WS is the sole freshness signal) |
| UI-only state | NgRx (selection, notifications) | Zustand | Pinia (notifications; selection stays in the URL) |
| Reactivity model | Signals, `store.selectSignal` → `$vm` | `useMemo` in the facade → plain VM object | `computed()` refs exposed by the facade |
| Facade | `UsersFacade`, root-scoped DI (`providedIn: 'root'`) | `useUsersFacade()` hook, component-scoped | `useUsersFacade()` composable → `ComputedRef` VM fields |
| Real-time WS singleton | NgRx Effect (framework-guaranteed singleton) | `useOrdersStream()` mounted once in `App` + pending-buffer for not-yet-loaded users | `useOrdersStream()` mounted once in `App` + pending buffer / eviction tombstones |
| Render perf | `OnPush` + Signals | `React.memo` + memoised facade values | Vue computed dependency tracking + reactive rendering |
| Virtual scroll | CDK `cdk-virtual-scroll-viewport` | `@tanstack/react-virtual` | `@tanstack/vue-virtual` |
| Notifications | `OrderNotificationsService` + NgRx | Zustand actions + module-level dismiss timers | Pinia actions + module-level dismiss timers |

## 🔀 Hybrid Microfrontend Architecture

The Hybrid mode runs React inside Angular using **Module Federation 2.0** — no iframes, no build-time coupling, independent deployments.

```
portal-shell (vanilla JS)
  └── /hybrid → users-portal-angular (host)
                   └── loadRemote('react-users/mount')
                         └── users-portal-react (remote)
                               mount(container, { initialPath, platform })
```

- React exposes one framework-agnostic `mount()` function, typed by the shared `MountMfe` contract — owns its own root, router, and query client, returns an `unmount()`
- Angular host (`ReactWrapperComponent`) has **zero React imports** — resolves the remote at runtime via `loadRemote`
- The host injects a shared **`@portal/platform`** SDK (`{ events: EventBus }`) at the mount seam — a typed, cross-MFE capability contract assembled once by a root `PlatformService` singleton, not re-created per mount
- `type: 'module'` federation + a dev-mode Fast Refresh preamble keep the remote working in both prod and local dev

→ Full `mount()` walkthrough, Platform SDK internals, and the module-federation gotchas: **[docs/mfe-architecture.md](docs/mfe-architecture.md)**

## 🤖 Agentic AI Development

This repository evolved from close collaboration with **Claude Code** into a deliberately **agentic development workflow**. I drove the core architecture and engineering guardrails early on, and I continue to own feature intent, architectural decisions, constraints, and review direction while increasingly delegating implementation details to Claude Code and automated agents. Those guardrails are encoded in `CLAUDE.md`, Nx boundaries, generators, and automated review.

| Layer | What it does |
| :--- | :--- |
| **`CLAUDE.md`** | The architectural source of truth — module boundaries, naming, layering, framework-isolation rules — read verbatim by Claude Code, the autonomous agent, and the PR review bot, so every agent works against the same rules instead of an implicit "house style" |
| **Slash commands** (`.claude/commands/`) | `/new-component`, `/sync-contract`, `/architecture-check` — explicit, scoped prompts for common changes, each one encoding the project's own conventions so the output doesn't depend on restating them every time |
| **Nx generator** (`feature-domain`) | `npm run g:feature-domain -- <name>` scaffolds a full dual-framework feature domain (35 files, both facades, path aliases) in one command — boundaries a human would otherwise have to remember are structural instead |
| **Autonomous agent** (`tools/agent.mjs`) | A hand-rolled Claude API tool-use loop — describe a goal in natural language, it scaffolds, edits, and validates across both frameworks unattended, with a confirmation gate before mutating actions |
| **PR review agent** (`tools/pr-review-agent.mjs`) | Loads `CLAUDE.md` verbatim as its own system prompt and reviews every PR diff for architecture drift against those same rules — layer boundaries, contract discipline, naming — posting a comment and **failing the check** on confirmed drift (a required status check on `main`) |

> The open question this repository is exploring: **how far can implementation be delegated to autonomous agents while still preserving architectural consistency, maintainability, and technical quality?**

Architecture and engineering guardrails remain human-directed; implementation increasingly runs through agents operating within them. This is separate from the [LLM Business Agent](docs/business-agent.md), which is an end-user product feature rather than part of the development workflow.

→ Full workflow details: **[docs/agentic-workflow.md](docs/agentic-workflow.md)**

## 🧩 Architecture Decisions & Trade-offs

Short rationale for choices a reviewer might otherwise read as arbitrary — full detail lives in the linked deep-dives, not duplicated here.

- **Facade-per-framework, not a shared abstraction layer** — each framework gets its own idiomatic facade (NgRx / TanStack+Zustand / TanStack+Pinia) behind one shared contract, rather than forcing a single cross-framework state library. See [docs/state-flow.md](docs/state-flow.md).
- **One canonical server-side store, not per-frontend mock data** — REST, WebSocket, and the Business Agent all read the same live Railway process state. This minimizes source-of-truth drift: the UI receives continuous WebSocket updates, while each agent request intentionally reasons over one atomic point-in-time snapshot rather than a live-updating view. See [docs/business-agent.md § Source-of-truth model](docs/business-agent.md#source-of-truth-model).
- **Hybrid MFE stays Angular-host / React-remote only** — Vue is a third standalone implementation, not yet a third Hybrid MFE remote; extending the composition is deliberately sequenced, not skipped. See [docs/roadmap.md](docs/roadmap.md).
- **`tools/business-agent-core.ts` lives outside the Nx lib tree** — a documented, reviewed exception: a small server-side subsystem shared by the local Business Agent dev server (`tools/business-agent-server.ts`) and the Vercel production handler (`api/business-agent.ts`), with a documented Vercel-bundling exception already hit once, not an oversight. See `CLAUDE.md`'s "Business Agent Server Code Location" section.

## 🧠 Design Patterns

### Reactive Facade

The facade draws a hard line between **Business Logic** (fetch/cache/derive/mutate — NgRx+Effects in Angular, TanStack Query+Zustand in React, TanStack Query+Pinia in Vue) and **Presentation Logic** (Angular components reading `$vm`; React/Vue components receiving props or reading `computed()` refs). Everything on the presentation side is purely props-in/events-out.

```
                   ┌─────────────────────────────┐
                   │         FACADE               │
                   │  (Business Logic boundary)   │
  NgRx / TanStack ─┤  - fetches & caches data     ├─► ViewModel (UserOrdersVm)
  Zustand / Pinia  │  - derives & memoises        │
  Router / URL     │  - handles interactions      ├─► Interactions (selectUser, dismiss)
                   └─────────────────────────────┘
                                  │
                    ┌─────────────▼────────────┐
                    │      Smart Component      │
                    │  (reads VM, owns layout)  │
                    └─────────────┬────────────┘
                                  │ props + callbacks
                    ┌─────────────▼────────────┐
                    │   Dumb Components (many)  │
                    │  props in → renders out   │
                    │  OnPush / React.memo /    │
                    │  Vue reactivity           │
                    └───────────────────────────┘
```

| Without facade | With facade |
| :--- | :--- |
| Components import NgRx actions / Zustand or Pinia stores directly | Components import nothing — only props |
| Swapping state libraries touches every component | Swap facade internals, components unchanged |
| Testing requires mocking the whole state tree | Test with plain prop objects |
| Business rules scattered across templates | BL lives in one place, independently testable |

### Domain-Driven Library Structure

The workspace is split into framework-specific libs under a shared domain root. Module boundary rules (Nx ESLint `@nx/enforce-module-boundaries`, configured in `eslint.config.mjs`) are enforced via `type:` tags (layer direction) and `framework:` tags (no cross-framework imports).

```text
apps/
  portal-shell           → Vanilla JS landing page (no build step)
  users-portal-angular   → Angular app shell + MFE host (/hybrid route)
  users-portal-react     → React app shell + MFE remote (exposes mount())
  users-portal-vue       → Vue app shell (standalone deploy only)

libs/
  users/                 → @portal/users/utils — shared by all three apps
                           Pure TS: domain models, pure utils, canonical mock data
  platform/              → @portal/platform — shared by Angular + React (Hybrid MFE seam)
                           MFE contract: MountMfe/MfeMountOptions, PlatformSDK, typed EventBus

  users-angular/         → NgRx store, effects, facade (data-access / feature / ui)
  users-react/           → TanStack Query, Zustand, useUsersFacade hook (data-access / feature / ui)
  users-vue/             → TanStack Vue Query, Pinia, useUsersFacade composable (data-access / feature / ui)
```

**Layer Rules (all three apps)**

| `type:` tag | Can depend on |
| :--- | :--- |
| `app` | `feature`, `data-access` |
| `feature` | `ui`, `data-access`, `utils` |
| `data-access` | `utils` |
| `ui` | `utils` |
| `utils` | `utils` |

**Framework Isolation Rules**

| `framework:` tag | Projects |
| :--- | :--- |
| `framework:angular` | `users-portal-angular`, `users-angular/*`, `business-agent-angular` |
| `framework:react` | `users-portal-react`, `users-react/*`, `business-agent-react` |
| `framework:vue` | `users-portal-vue`, `users-vue/*`, `business-agent-vue` |
| `framework:shared` | `users/utils`, `platform`, `business-agent-widget` |

Angular, React, and Vue libs must never import from each other. Only `framework:shared` libs may be imported by all three — `platform` is currently consumed by Angular and React only, since Vue isn't part of the Hybrid MFE composition (see [Architecture Decisions & Trade-offs](#-architecture-decisions--trade-offs) above).

→ Per-framework facade implementations and all three state-flow diagrams: **[docs/state-flow.md](docs/state-flow.md)**

## 🚧 Intentional Demo Limitations

Demo-scale trade-offs, not accidental gaps — each is a deliberate call for a portfolio-scale deployment, documented where it's actually implemented:

- In-memory, process-local Orders store with per-user FIFO retention capped at 30 orders — no persistence (a Railway restart resets all demo data) and no full lifetime history, including for the Business Agent. See [docs/business-agent.md § Demo-scale simplifications](docs/business-agent.md#demo-scale-simplifications) and [§ What the agent can see](docs/business-agent.md#what-the-agent-can-see).
- One shared live demo, not a per-visitor sandbox — every visitor reads (and is affected by) the same canonical backend state.
- No authentication/session layer yet — planned, not started. See [docs/roadmap.md](docs/roadmap.md).
- Demo-scale rate/cost safeguards (8 requests/60s, `MAX_TURNS=8`, bounded output/history) sized for a portfolio demo, not production traffic. See [docs/business-agent.md § Cost & rate-limit safeguards](docs/business-agent.md#cost--rate-limit-safeguards).

## 💻 Local Development

```bash
npm install

# Angular — http://localhost:4200 (also starts the WS mock + local Business Agent server)
npm run validate:angular && npm run start:angular

# React — http://localhost:4201 (also starts the WS mock + local Business Agent server)
npm run validate:react && npm run start:react

# Vue — http://localhost:4202 (also starts the WS mock + local Business Agent server)
npm run validate:vue && npm run start:vue

# Shell — http://localhost:4000 (no build step)
npm run start:shell
```

**Hybrid MFE mode** requires the React remote and the Angular host running together — but `start:react` and `start:angular` each independently start their own `mock:ws` (port 3000) and `business-agent` (port 8787) processes via `concurrently`, so running both scripts at once conflicts on those ports. Start the shared services only once, via `start:react`, then serve the Angular host directly:

```bash
# Terminal 1 — React remote + the shared WS mock + Business Agent server
npm run start:react

# Terminal 2 — Angular host only (shared services already running)
npx nx serve users-portal-angular
```

Then open `http://localhost:4200/hybrid`. The vanilla-JS shell (`start:shell`) is optional — it only adds a landing page with a **Hybrid** button that links to the same URL. The React dev server must be on port 4201 — Angular's `main.ts` resolves the remote at `http://localhost:4201/remoteEntry.js` in development.

```bash
npm run validate   # lint + test everything, all frameworks
```

## 🛠 Available Commands

| Command | Scope | Description |
| :--- | :--- | :--- |
| `npm run start:angular` / `start:react` / `start:vue` | Angular / React / Vue | Serves the app (`:4200` / `:4201` / `:4202`) **and** the WS mock + local Business Agent server together, via `concurrently` |
| `npm run start:shell` | — | Serve the vanilla-JS shell (`:4000`, no build step) |
| `npm run mock:ws` | All | WS mock server at `ws://localhost:3000/orders` — already bundled into every `start:*` script above; only needed standalone otherwise |
| `npm run business-agent` | All | Local Business Agent server at `http://localhost:8787` — already bundled into every `start:*` script above; only needed standalone otherwise |
| `npm run validate` | All | Lint + test everything |
| `npm run validate:angular` / `validate:react` / `validate:vue` | Angular / React / Vue | Lint + test that framework + shared lib |
| `npm run build:angular` / `build:react` / `build:vue` | Angular / React / Vue | Validate + production build |
| `npm run pr-review` / `agent` / `g:feature-domain` | All / Angular+React | Local PR reviewer, autonomous agent, and feature-domain generator — see [Agentic AI Development](#-agentic-ai-development) for what each does |

## 🧪 Testing

- **Angular** — Jest, zoneless test environment (`setupZonelessTestEnv`)
- **React** — Vitest + `@testing-library/react`, `jsdom`; always set `gcTime: 0` on test `QueryClient`s and use `vi.useFakeTimers()` around notification auto-dismiss
- **Vue** — Vitest + `@vue/test-utils`, `jsdom`; same `gcTime: 0` / fake-timers discipline as React, for TanStack Vue Query and notification auto-dismiss
- **Shared utils** — Jest, framework-agnostic pure TS
- No external backend required for local development — all three apps run against the repo's own in-memory HTTP/WebSocket Orders backend (`tools/mock-orders-ws-server.mjs`)

## 📖 Deep Dives

- **[docs/mfe-architecture.md](docs/mfe-architecture.md)** — full `mount()` API, Platform SDK internals, module-federation gotchas
- **[docs/state-flow.md](docs/state-flow.md)** — per-framework facade code, all three state-flow diagrams (Angular/React/Vue)
- **[docs/business-agent.md](docs/business-agent.md)** — LLM-Powered Business Agent architecture, agent loop, canonical source-of-truth model, deployment & security
- **[docs/agentic-workflow.md](docs/agentic-workflow.md)** — slash command examples, the autonomous agent's tool loop, generator internals, PR review agent design
- **[docs/roadmap.md](docs/roadmap.md)** — planned work: authentication & platform, multi-framework MFE evolution, runtime resilience
