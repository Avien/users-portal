
# 👤 Users Portal

This repository explores how the same frontend domain can evolve across:

- Angular standalone architecture
- Idiomatic React architecture
- Shared framework-agnostic domain utilities
- Cross-framework Microfrontend compositions
- Agentic AI workflows for cross-framework architectural exploration and implementation

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

## 📦 Project Overview

This Nx monorepo contains Angular, React, and Hybrid Microfrontend implementations of the same domain — a users-and-orders dashboard with real-time WebSocket updates, deployed as independent Vercel projects that compose at runtime via Module Federation 2.0.

| App | Stack | Purpose |
| :--- | :--- | :--- |
| `apps/portal-shell` | Vanilla JS, no build step | Landing page — mode selector, redirects to any app |
| `apps/users-portal-angular` | Angular 21, NgRx, Signals, OnPush | Reference implementation + Hybrid MFE host |
| `apps/users-portal-react` | React 19, TanStack Query, Zustand, Vite | Idiomatic React rebuild + MFE remote |

The UI lists users and their orders. Selecting a user loads orders lazily with per-user caching; a WebSocket stream pushes live updates merged into the cache without overwriting lazily loaded data; high-value and burst orders trigger auto-dismissing toast notifications.

## 🔔 Order Monitoring Notifications

- **Warning** — a newly streamed order crosses the high-value threshold (`>= $500`)
- **Critical** — the same user receives multiple new streamed orders within a 2-minute burst window
- **Noise control** — bulk API hydration is ignored to avoid toast spam; only streamed events trigger toasts
- Pure detection logic (`reduceOrderMonitoring`) lives in the shared `@portal/users/utils` lib — both facades run the same rule, wire it to their own state layer (NgRx effect vs Zustand action)

**Try it locally:**
```bash
npm run mock:ws && npm start
```
On connect, the mock server immediately emits two orders for the same user (~0.5s/~1.5s in) to trigger the critical burst toast without waiting for the random stream. In production the same server runs persistently on Railway; Angular and React each read its URL from their own environment config.

## ⚖️ Architecture at a Glance

Same domain, same facade contract (`UserOrdersVm & IUsersFacadeInteractions`), idiomatic internals per framework:

| Concern | Angular | React |
| :--- | :--- | :--- |
| Server/domain state | NgRx + NgRx Entity (normalized, effects) | TanStack Query (`staleTime: Infinity` — WS is the sole freshness signal) |
| UI-only state | NgRx (selection, notifications) | Zustand |
| Reactivity model | Signals, `store.selectSignal` → `$vm` | `useMemo` in the facade → plain VM object |
| Facade | `UsersFacade`, root-scoped DI (`providedIn: 'root'`) | `useUsersFacade()` hook, component-scoped |
| Real-time WS singleton | NgRx Effect (framework-guaranteed singleton) | `useOrdersStream()` mounted once in `App` + pending-buffer for not-yet-loaded users |
| Render perf | `OnPush` + Signals | `React.memo` + memoised facade values |
| Virtual scroll | CDK `cdk-virtual-scroll-viewport` | `@tanstack/react-virtual` |
| Notifications | `OrderNotificationsService` + NgRx | Zustand actions + module-level dismiss timers |

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

# React — http://localhost:4201
npm run validate:react && npm run mock:ws && npm run start:react

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
| `npm run start:angular` / `start:react` / `start:shell` | — | Serve each app (`:4200` / `:4201` / `:4000`) |
| `npm run mock:ws` | Both | WS mock server at `ws://localhost:3000/orders` |
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
* Scalable **Nx monorepo** with two parallel framework implementations + a framework-agnostic shell
* **Shared domain contracts** (`@portal/users/utils`) consumed by both Angular and React
* **Module boundary enforcement** via Nx ESLint `type:` + `framework:` tags
* **Facade pattern** in both frameworks — same public surface, idiomatic internals
* **WebSocket stream** with pending-buffer pattern and real-time order monitoring (shared pure logic)
* **Hybrid MFE** — Module Federation 2.0, framework-agnostic `mount()` API, injected Platform SDK + cross-MFE `EventBus`
* **Agentic AI workflow** — slash commands, an Nx generator, an autonomous Claude API agent, and a PR review bot, all sharing one `CLAUDE.md` as the architectural source of truth

## 📖 Deep Dives

- **[docs/mfe-architecture.md](docs/mfe-architecture.md)** — full `mount()` API, Platform SDK internals, module-federation gotchas
- **[docs/state-flow.md](docs/state-flow.md)** — per-framework facade code, both state-flow diagrams (Angular/React)
- **[docs/agentic-workflow.md](docs/agentic-workflow.md)** — slash command examples, the autonomous agent's tool loop, generator internals, PR review agent design
