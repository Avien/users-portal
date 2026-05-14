
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

<a href="https://users-portal-angular.vercel.app">
  <img src="https://img.shields.io/badge/-Angular-DD0031?style=for-the-badge&logo=angular&logoColor=white" />
</a>

<a href="https://users-portal-react.vercel.app">
  <img src="https://img.shields.io/badge/-React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" />
</a>

## 📦 Project Overview

This Nx monorepo contains **two parallel implementations** of the same domain — a users-and-orders dashboard with real-time WebSocket updates:

| App | Stack | Purpose |
| :--- | :--- | :--- |
| `apps/users-portal-angular` | Angular 19, NgRx, Signals, OnPush | Reference implementation |
| `apps/users-portal-react` | React 19, TanStack Query, Zustand, Vite | Idiomatic React rebuild |

The UI displays a list of users and their associated orders. Selecting a user loads orders lazily with per-user caching. A WebSocket stream pushes live order updates that are merged into the cache without overwriting lazily loaded data. High-value and burst orders trigger toast notifications with auto-dismiss.

The project demonstrates how the same domain and architectural patterns (facade, layered libs, module boundaries, reactive state) map across two fundamentally different frontend paradigms.

## 🏗 Architectural Highlights (Angular App)

* **Nx Monorepo:** Organized with strict boundaries between the App Shell (`users-portal`) and the domain libraries (`feature`, `ui`, `data-access`, `utils`), with architectural constraints enforced through Nx ESLint module boundary rules.
* **Utils Library:** Hosts pure business logic utilities that are framework-agnostic, reusable, and independently unit tested, promoting clean separation between domain logic and framework-specific code.
* **State Management (NgRx):** Powered by NgRx, utilizing **NgRx Entity** for normalized state storage and highly efficient CRUD operations.
* **Real-time Order Ingestion:** WebSocket events are consumed through Effects and merged into store state without losing lazily loaded API data.
* **Modern Angular (v21):** Built on the absolute bleeding edge of the framework, utilizing:
  * Strict Standalone Components
  * The latest control flow syntax (`@if`, `@for`)
  * Angular Signals
  * Purely Zoneless testing environments (`setupZonelessTestEnv`)
* **Signals + Selectors Integration:** NgRx selectors are seamlessly converted into Angular Signals using `store.selectSignal`, bridging the gap between global state and local reactivity.
* **Performance & Smart Caching:** The Facade uses per-user loaded flags (`loadedUserIds`) instead of order-list length, preventing false cache hits when partial WebSocket data arrives before first API load.

## 🏗 Architectural Highlights (React App)

* **Server State vs UI State separation:** TanStack Query owns all server state (users list, per-user orders cache). Zustand owns UI state (`selectedUserId`, `notifications`). The two never overlap.
* **`staleTime: Infinity` on orders:** The WebSocket stream is the sole freshness mechanism — no background refetching that could overwrite live data. Orders accumulate via cache updates, not re-fetches.
* **WebSocket as an explicit singleton:** Unlike Angular's NgRx Effects (automatically singleton), React requires intentional placement. `useOrdersStream()` lives in `App`, not in any per-user component, mirroring the Effect lifecycle.
* **Pending buffer pattern:** WS orders for users whose API data hasn't loaded yet are buffered in a module-level Map (`pendingByUser`). The facade drains and merges the buffer via a `useEffect` once `ordersQuery.isSuccess` fires — no race condition, no lost events.
* **Facade hook as the NgRx equivalent:** `useUsersFacade()` composes TanStack Query + Zustand and returns a plain object matching `UserOrdersVm & IUsersFacadeInteractions`. Components are unaware of either library.
* **`React.memo` + `useMemo` as OnPush + Selectors:** Presentational components wrapped in `React.memo` only re-render when props change. All derived values (selected user, order summary) are memoised in the facade — equivalent to NgRx memoised selectors.
* **Virtual scroll:** The orders list uses `@tanstack/react-virtual` (headless, same ecosystem as TanStack Query) for fixed-size row virtualisation — the React equivalent of Angular CDK `cdk-virtual-scroll-viewport`.
* **Notifications via Zustand actions + module-level timers:** `addNotification` / `dismissNotification` with a module-level `dismissTimers` Map replaces Angular's `OrderNotificationsService` class — no extra service abstraction needed since the Zustand store IS the singleton.

---

## 🔔 Order Monitoring Notifications

The dashboard includes a real-time monitoring layer that turns streamed order activity into actionable UI toasts.

### What triggers a notification

- **Warning:** a newly streamed order crosses the high-value threshold (`>= $500`)
- **Critical:** the same user receives multiple new streamed orders within a short burst window (2 minutes by default)
- **Noise control:** bulk order inserts (for example, lazy API hydration) are intentionally ignored to avoid toast spam

### Architecture split

- **Pure monitoring rules (`libs/users` → `@portal/users/utils`)**  
  `reduceOrderMonitoring()` and related helpers evaluate incoming order snapshots and return lightweight toast payloads. Shared by both apps.
- **Angular — Facade orchestration (`libs/users-angular/data-access`)**  
  `UsersFacade` runs the monitoring NgRx effect, owns the notifications signal on `$vm`, and keeps store interaction centralized. `OrderNotificationsService` handles ids, timestamps, auto-dismiss timers, and cleanup.
- **React — Zustand store + `useOrdersStream` (`libs/users-react/data-access`)**  
  `addNotification` / `dismissNotification` actions with module-level `dismissTimers` replace the Angular service. `useOrdersStream` (called once from `App`) runs `reduceOrderMonitoring` on each WS tick and dispatches to the store.
- **Feature/UI rendering (both apps)**  
  Toasts are rendered via `toast-stack` from `vm.notifications`.

### Try it locally

```bash
npm run mock:ws
npm start
```

Then open the Users dashboard and watch incoming `order-update` events produce warning/critical toasts when conditions are met.

---

## 🧠 Design Patterns

### Reactive Facade Pattern
To maintain strict separation of concerns, the UI components have **zero knowledge of NgRx**.

All interactions with the Store and network requests are handled entirely by the `UsersFacade`. The facade exposes state exclusively through computed **Angular Signals**, including a single `$vm` signal that provides a perfectly mapped view model for the UI.

This approach results in:
* Very simple, "dumb" UI components
* Zero manual RxJS subscriptions in the components or templates
* Clear, strict separation of business logic from presentation
* A highly testable architecture

### ⚡ State Flow
The application follows a predictable reactive flow:

```text
User Interaction
  ↓
Feature Component
  ↓
UsersFacade
  ↓
NgRx Actions
  ↓
Effects (API calls + WS stream mapping)
  ↓
Reducers (state updates)
  ↓
Selectors
  ↓
Angular Signals
  ↓
ViewModel
  ↓
UI Rendering
```

### Domain-Driven Library Structure

The workspace is split into framework-specific libs under a shared domain root. Module boundary rules (Nx ESLint `@nx/enforce-module-boundaries`) are enforced via `type:` tags (layer direction) and `framework:` tags (no cross-framework imports).

```text
apps/
  users-portal-angular   → Angular app shell
  users-portal-react     → React app shell

libs/
  users/                 → @portal/users/utils — shared by both apps
                           Pure TS: domain models, pure utils, canonical mock data

  users-angular/
    data-access          → NgRx store, effects, services, facade
    feature              → Angular smart container
    ui                   → Angular presentational components

  users-react/
    data-access          → TanStack Query API fns, Zustand store, useOrdersStream
    feature              → useUsersFacade hook
    ui                   → React presentational components (incl. virtual scroll)
```

#### Layer Rules (both apps)

| `type:` tag | Can depend on |
| :--- | :--- |
| `app` | `feature`, `data-access` |
| `feature` | `ui`, `data-access`, `utils` |
| `data-access` | `utils` |
| `ui` | `utils` |
| `utils` | `utils` |

---

## 💻 Local Development

```bash
# Install all dependencies
npm install
```

**Angular app**
```bash
npm run validate:angular   # lint + test Angular projects
npm run mock:ws            # start WS mock server at ws://localhost:3000/orders (optional)
npm start                  # serve at http://localhost:4200
```

**React app**
```bash
npm run validate:react     # lint + test React projects
npm run mock:ws            # same WS server works for both apps
npm run start:react        # serve at http://localhost:4201
```

**Both apps**
```bash
npm run validate           # lint + test everything
```

---

## 🛠 Available Commands

| Command | Scope | Description |
| :--- | :--- | :--- |
| `npm start` | Angular | Serve Angular app at `http://localhost:4200` |
| `npm run start:react` | React | Serve React app at `http://localhost:4201` |
| `npm run mock:ws` | Both | Start WS mock server at `ws://localhost:3000/orders` |
| `npm run format` | Both | Run Prettier across the workspace |
| `npm run lint` | Both | ESLint across the entire monorepo |
| `npm run test` | Both | Run all test suites (Jest + Vitest) |
| `npm run validate` | Both | Lint + test everything |
| `npm run validate:angular` | Angular | Lint + test Angular projects + shared lib |
| `npm run validate:react` | React | Lint + test React projects + shared lib |
| `npm run build:prod` | Angular | Validate + production build → `dist/apps/users-portal-angular` |
| `npm run build:angular` | Angular | Same as `build:prod` |
| `npm run build:react` | React | Validate + production build → `dist/users-portal-react` |

---

## 🧪 Testing

Libraries are tested independently to ensure isolated domain logic.

**Angular** — uses **Jest** with zoneless Angular test environment:
```typescript
import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';
setupZonelessTestEnv({ errorOnUnknownElements: true, errorOnUnknownProperties: true });
```

**React** — uses **Vitest** with `@testing-library/react`:
- `environment: jsdom` (configured per-lib in `vite.config.ts`)
- Always set `gcTime: 0` in test `QueryClient` instances to prevent TanStack Query GC timers from keeping the test runner alive
- Use `vi.useFakeTimers()` in specs that trigger Zustand `addNotification` (auto-dismiss timers)

**Shared utils** — tested with **Jest** (framework-agnostic pure TS).

---

## 📝 Notes

- Both apps use **mock data** served by `tools/mock-orders-ws-server.mjs` and in-memory API stubs. No real backend required.
- Run `npm run mock:ws` before starting either app to see live order streaming.
- **Angular** — `UsersFacade` abstracts all NgRx interactions (actions, selectors, effects) from the UI. Components only see Angular Signals from `$vm`.
- **React** — `useUsersFacade()` plays the same role: it composes TanStack Query + Zustand and returns `UserOrdersVm & IUsersFacadeInteractions`. Components only see plain props.
- Both facades share the same `UserOrdersVm` / `IUsersFacadeInteractions` contracts from `@portal/users/utils`, enforcing a consistent public surface across frameworks.
- The orders list in the React app uses `@tanstack/react-virtual` for virtualized rendering (equivalent to Angular CDK `cdk-virtual-scroll-viewport`).


## 📌 Summary

This project demonstrates:
* Scalable **Nx monorepo** with two parallel framework implementations
* **Shared domain contracts** (`@portal/users/utils`) consumed by both Angular and React
* **Module boundary enforcement** via Nx ESLint `type:` + `framework:` tags
* **Angular** — NgRx Entity + Selectors, Angular Signals, OnPush, CDK Virtual Scroll
* **React** — TanStack Query, Zustand, `@tanstack/react-virtual`, `React.memo`
* **Facade pattern** in both frameworks: same public surface (`UserOrdersVm`), idiomatic internals
* **WebSocket stream** with pending-buffer pattern and real-time order monitoring (shared pure logic)
* **Scoped CI scripts** — `validate:angular` / `validate:react` / `build:angular` / `build:react`


## 🤖 AI-Assisted Development

This project was built across two phases, each with a different AI pairing:

**Angular app** (`apps/users-portal-angular`) — built with **ChatGPT + Cursor**
- Architecture was designed upfront by translating product requirements into a clear structural model (Nx boundaries, NgRx patterns, facade contract)
- AI generated the initial implementation baseline aligned to that architecture
- Refined iteratively through engineering-led review, testing, and targeted improvements
- Final design decisions, trade-offs, and code quality were owned and validated manually

**React app** (`apps/users-portal-react`) — rebuilt with **Claude Code** (this repo)
- The Angular app serves as the architectural reference; the goal is an idiomatic React rebuild — not a direct translation
- Claude Code was used as a pair-programmer throughout: implementing features, explaining Angular→React mental model shifts, writing tests, and catching architectural drift
- All decisions (patterns, naming, boundaries) were reviewed and approved incrementally
- Serves as a learning exercise in how the same domain maps across two very different frontend paradigms

