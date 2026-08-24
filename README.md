
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
On the first WebSocket connection after a server-process start, the mock server emits three demo orders for the same user (~0.5s/~1.5s/~2.5s in) — the first is swallowed by the monitoring rule's own learning tick, the second (>= $500) triggers the warning toast, the third triggers the critical burst toast — without waiting for the random stream. That startup burst is scheduled once per server process, not once per connection: a later visitor connecting to an already-running process (including on Railway in production) does not trigger another burst — they simply join the ongoing process-level random order stream already in progress, with nothing in the UI to distinguish "just joined a live process" from "was already watching it" (see the *Live WebSocket order visual feedback* item in [docs/roadmap.md](docs/roadmap.md)'s Post-production / Portfolio Polish section). Connecting a second tab/framework does not cause more orders to be generated — generation is a property of the process, not the connection count. In production the same server runs persistently on Railway; Angular, React, and Vue each read its URL from their own environment config — all three are production-deployed, production-configured, and read the same live canonical backend.

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

`tools/mock-orders-ws-server.mjs` owns the one canonical, in-memory order store — module-scope, shared across every connection, and the single origin for every order in the system, including ones generated after startup (the same file runs on Railway in production). Each frontend's initial load reads `GET /api/orders` (the current `Order[]`); `WS /orders` then pushes incremental updates to connected frontends. The Business Agent reads a separate `GET /api/orders-snapshot` endpoint — the same canonical store, bundled with the arrival-timestamp metadata its monitoring tools need. Without this, a browser refresh after new orders arrived would show stale mock-only data while the agent saw a different picture (or vice versa) — reading from one shared source is what keeps them in sync.

The store retains the latest 30 orders per user (`tools/orders-store.mjs`) — a small, demo-appropriate bound so a long-lived Railway process doesn't grow every reader's payload (and the Business Agent's token usage) unboundedly. Retention is centralized at the store itself, so `GET /api/orders`, `GET /api/orders-snapshot`, and every WS consumer always see the exact same retained set — newest orders always win, oldest are pruned (along with their arrival metadata) once a user crosses the cap.

## 🤖 LLM-Powered Business Agent

A Claude-powered agent that answers natural-language questions over live Users/Orders data via structured tool calling — not a chatbot wrapper, an actual `model → tool → result → model` loop reading the same canonical backend state the UI does.

- Bounded multi-turn conversational context — follow-up questions resolve pronouns/references from the visible transcript
- One framework-independent `<business-agent-widget>` Web Component (Shadow DOM), shared verbatim by all three standalone apps (Angular, React, Vue) and by the Hybrid MFE composition (Angular host + React remote)
- The UI and Business Agent derive from the same canonical backend state, minimizing source-of-truth drift: frontends use HTTP snapshot + WS deltas, while the agent takes a fresh canonical snapshot for each request
- Server-side-only Vercel API — `ANTHROPIC_API_KEY` never reaches the browser, rate-limited and sanitized at the production boundary

→ Full architecture, agent loop, and deployment details: **[docs/business-agent.md](docs/business-agent.md)**

## ⚖️ Architecture at a Glance

Same domain, same facade contract (`UserOrdersVm & IUsersFacadeInteractions`), idiomatic internals per framework:

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

Most of the implementation in this repository was built with **Claude Code**, while architecture, design, and review were led by me throughout. `CLAUDE.md` is the source of truth I maintain for those decisions — Claude Code, the autonomous agent, and the PR review bot all read it verbatim. That same source of truth is then encoded into the tooling itself:

| Layer | What it does |
| :--- | :--- |
| **Slash commands** (`.claude/commands/`) | `/new-component`, `/sync-contract`, `/architecture-check` — say what you want in plain language, Claude routes to the right one |
| **Nx generator** (`feature-domain`) | `npm run g:feature-domain -- <name>` scaffolds a full dual-framework feature domain (35 files, both facades, path aliases) in one command |
| **Autonomous agent** (`tools/agent.mjs`) | A hand-rolled Claude API tool-use loop — describe a goal, it scaffolds + edits + validates across both frameworks unattended |
| **PR review agent** (`tools/pr-review-agent.mjs`) | GitHub Actions bot — reviews every PR diff for architecture drift against `CLAUDE.md`, posts a comment, and **fails the check** on confirmed drift (required status check, once branch protection is enabled) |

> "The tech lead's job is to make AI follow the architecture, not invent a new one every time."

→ Full breakdown — slash command examples, the agent's tool loop, generator internals, PR review agent design: **[docs/agentic-workflow.md](docs/agentic-workflow.md)**

## 🧠 Design Patterns

### Reactive Facade

The facade draws a hard line between **Business Logic** (fetch/cache/derive/mutate — NgRx+Effects in Angular, TanStack Query+Zustand in React) and **Presentation Logic** (Angular components reading `$vm`; React components receiving props). Everything on the presentation side is purely props-in/events-out.

```
                   ┌─────────────────────────────┐
                   │         FACADE               │
                   │  (Business Logic boundary)   │
  NgRx / TanStack ─┤  - fetches & caches data     ├─► ViewModel (UserOrdersVm)
  Zustand / RxJS   │  - derives & memoises        │
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
                    │  OnPush / React.memo      │
                    └──────────────────────────┘
```

| Without facade | With facade |
| :--- | :--- |
| Components import NgRx actions / Zustand stores directly | Components import nothing — only props |
| Swapping state libraries touches every component | Swap facade internals, components unchanged |
| Testing requires mocking the whole state tree | Test with plain prop objects |
| Business rules scattered across templates | BL lives in one place, independently testable |

### Domain-Driven Library Structure

The workspace is split into framework-specific libs under a shared domain root. Module boundary rules (Nx ESLint `@nx/enforce-module-boundaries`) are enforced via `type:` tags (layer direction) and `framework:` tags (no cross-framework imports).

```text
apps/
  portal-shell           → Vanilla JS landing page (no build step)
  users-portal-angular   → Angular app shell + MFE host (/hybrid route)
  users-portal-react     → React app shell + MFE remote (exposes mount())

libs/
  users/                 → @portal/users/utils — shared by both apps
                           Pure TS: domain models, pure utils, canonical mock data

  platform/              → @portal/platform — shared by both apps
                           MFE contract: MountMfe/MfeMountOptions, PlatformSDK, typed EventBus

  users-angular/
    data-access          → NgRx store, effects, services, facade
    feature              → Angular smart container
    ui                   → Angular presentational components

  users-react/
    data-access          → TanStack Query API fns, Zustand store, useOrdersStream
    feature              → useUsersFacade hook
    ui                   → React presentational components (incl. virtual scroll)
```

**Layer Rules (both apps)**

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
| `framework:angular` | `users-portal-angular`, `users-angular/data-access`, `users-angular/feature`, `users-angular/ui` |
| `framework:react` | `users-portal-react`, `users-react/data-access`, `users-react/feature`, `users-react/ui` |
| `framework:shared` | `users/utils`, `platform` |

Angular and React libs must never import from each other. Only `framework:shared` libs may be imported by both.

→ Per-framework facade implementations and both state-flow diagrams (Angular/React): **[docs/state-flow.md](docs/state-flow.md)**

## 💻 Local Development

```bash
npm install

# Angular — http://localhost:4200
npm run validate:angular && npm run mock:ws && npm run start:angular

# React — http://localhost:4201 (also starts the WS mock + local Business Agent server)
npm run validate:react && npm run start:react

# Shell — http://localhost:4000 (no build step)
npm run start:shell
```

**Hybrid MFE mode** needs all three running (React remote first): `start:react` → `start:angular` → `start:shell` (optional), then open `http://localhost:4200/hybrid` or use the shell's **Hybrid** button. The React dev server must be on port 4201 — Angular's `main.ts` resolves the remote at `http://localhost:4201/remoteEntry.js` in development.

```bash
npm run validate   # lint + test everything, all frameworks
```

## 🛠 Available Commands

| Command | Scope | Description |
| :--- | :--- | :--- |
| `npm run start:angular` / `start:shell` | — | Serve each app (`:4200` / `:4000`) |
| `npm run start:react` | React | Serves the app (`:4201`) **and** the WS mock + local Business Agent server together, via `concurrently` |
| `npm run mock:ws` | Both | WS mock server at `ws://localhost:3000/orders` — only needed standalone for Angular |
| `npm run business-agent` | React | Local Business Agent server at `http://localhost:8787` — only needed standalone outside `start:react` |
| `npm run validate` | All | Lint + test everything |
| `npm run validate:angular` / `validate:react` | Angular / React | Lint + test that framework + shared lib |
| `npm run build:angular` / `build:react` | Angular / React | Validate + production build |
| `npm run pr-review -- --base origin/main` | All | Run the architecture-drift PR reviewer locally |
| `npm run agent -- "<goal>"` | All | Run the autonomous feature-domain agent |
| `npm run g:feature-domain -- <name>` | All | Scaffold a new dual-framework feature domain |

## 🧪 Testing

- **Angular** — Jest, zoneless test environment (`setupZonelessTestEnv`)
- **React** — Vitest + `@testing-library/react`, `jsdom`; always set `gcTime: 0` on test `QueryClient`s and use `vi.useFakeTimers()` around notification auto-dismiss
- **Shared utils** — Jest, framework-agnostic pure TS
- No real backend required — both apps run on mock data (`tools/mock-orders-ws-server.mjs` + in-memory API stubs)

## 📌 Summary

This project demonstrates:
* Scalable **Nx monorepo** with three parallel framework implementations + a framework-agnostic shell
* **Shared domain contracts** (`@portal/users/utils`) consumed by Angular, React, and Vue
* **Module boundary enforcement** via Nx ESLint `type:` + `framework:` tags
* **Facade pattern** across frameworks — same public surface, idiomatic internals
* **WebSocket stream** with pending-buffer pattern and real-time order monitoring (shared pure logic)
* **Hybrid MFE** — Module Federation 2.0, framework-agnostic `mount()` API, injected Platform SDK + cross-MFE `EventBus`
* **LLM-Powered Business Agent** — Claude API + structured tool calling over live business data, one shared Web Component across all three frameworks
* **Agentic AI workflow** — slash commands, an Nx generator, an autonomous Claude API agent, and a PR review bot, all sharing one `CLAUDE.md` as the architectural source of truth

## 📖 Deep Dives

- **[docs/mfe-architecture.md](docs/mfe-architecture.md)** — full `mount()` API, Platform SDK internals, module-federation gotchas
- **[docs/state-flow.md](docs/state-flow.md)** — per-framework facade code, both state-flow diagrams (Angular/React)
- **[docs/business-agent.md](docs/business-agent.md)** — LLM-Powered Business Agent architecture, agent loop, canonical source-of-truth model, deployment & security
- **[docs/agentic-workflow.md](docs/agentic-workflow.md)** — slash command examples, the autonomous agent's tool loop, generator internals, PR review agent design
- **[docs/roadmap.md](docs/roadmap.md)** — planned work: authentication & platform, multi-framework MFE evolution, runtime resilience
