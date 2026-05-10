
# 👤 Users Portal

A modern, scalable frontend architecture showcase, originally developed as a high-performance trading-style data visualization system.

**🚀 [Live Demo](https://users-portal-system.vercel.app/)**

## 📦 Project Overview

This application demonstrates a scalable Angular architecture using Nx, NgRx, and Angular Signals.

The UI displays a list of users and their associated orders. Selecting a user loads orders lazily, with per-user cache tracking to avoid redundant API calls while still allowing real-time updates.

The app now supports a WebSocket-driven order stream (`order-update`) that feeds NgRx in real time. Incoming socket events are normalized, merged with lazy API loads, and rendered reactively through selectors + signals.

The project focuses on clean architectural boundaries, reactive state management, and modern Angular best practices.

## 🏗 Architectural Highlights

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

---

## 🔔 Order Monitoring Notifications

The dashboard includes a real-time monitoring layer that turns streamed order activity into actionable UI toasts.

### What triggers a notification

- **Warning:** a newly streamed order crosses the high-value threshold (`>= $500`)
- **Critical:** the same user receives multiple new streamed orders within a short burst window (2 minutes by default)
- **Noise control:** bulk order inserts (for example, lazy API hydration) are intentionally ignored to avoid toast spam

### Architecture split

- **Pure monitoring rules (`libs/users/utils`)**  
  `reduceOrderMonitoring()` and related helpers evaluate incoming order snapshots and return lightweight toast payloads.
- **Facade orchestration (`libs/users/data-access`)**  
  `UsersFacade` runs the monitoring effect, owns the notifications signal exposed on `$vm`, and keeps store interaction centralized.
- **Notification mechanics service (`libs/users/data-access/src/lib/services`)**  
  `OrderNotificationsService` handles notification ids, timestamps, auto-dismiss timers, manual dismiss, and cleanup.
- **Feature/UI rendering (`libs/users/feature` + `libs/users/ui`)**  
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
The workspace is split into clear domain boundaries under `libs/users/`.

```text
apps/
  users-portal       → Application shell

libs/users/
  data-access        → NgRx store, effects, services, facade
  feature            → Smart components connecting facade to UI
  ui                 → Pure presentational components
  utils              → Models, types and view models
```

#### Library Responsibilities

| Library | Responsibility |
| :--- | :--- |
| `data-access` | State management (NgRx Store, Effects, Facade) |
| `feature` | Smart components orchestrating UI logic |
| `ui` | Pure presentation components |
| `utils` | Shared models, interfaces and view models |

This structure enforces **clean architectural boundaries** and improves maintainability.

---

## 💻 Local Development

To get the project running locally, execute the following commands in your terminal:

```bash
# 1. Install all dependencies
npm install

# 2. Run the comprehensive Jest test suite
npm run test

# 3. Start the local WS mock stream (optional but recommended for live updates)
npm run mock:ws

# 4. Serve the application locally
npm start
# The app will automatically open and reload at http://localhost:4200/
```

---

## 🛠 Available Commands

This workspace is configured with custom npm scripts to streamline development and CI pipelines:

| Command | Description |
| :--- | :--- |
| `npm start` | Serves the `users-portal` application locally at `http://localhost:4200/`. |
| `npm run mock:ws` | Starts a local WebSocket server at `ws://localhost:3000/orders` that emits mock `order-update` events. |
| `npm run format` | Runs Prettier to auto-format all code. |
| `npm run lint` | Runs ESLint across the entire Nx monorepo. |
| `npm run test` | Executes the Jest test suites across all isolated libraries. |
| `npm run validate` | Runs both linting and testing. Ideal for pre-commit checks. |
| `npm run build:prod` | Validates the codebase and generates the optimized production build. |

---

## 🧪 Testing

The workspace uses **Jest** for testing. Libraries are tested independently to ensure isolated domain logic.

The test environment is configured for **Zoneless Angular testing** using:

```typescript
import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';

setupZonelessTestEnv({
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true
});
```

---

## 📝 Notes

- The app is built using **Nx** for a **strict monorepo structure** and **Nx plugins** for efficient development workflows.
- This project uses **mock data** for demonstration purposes. In a real-world application, the `UserService` would communicate with backend APIs via Angular's `HttpClient`.
- Real-time updates are simulated locally through `tools/mock-orders-ws-server.mjs`; run `npm run mock:ws` before `npm start` to see streaming order creation.
- The `UsersFacade` is responsible for managing the NgRx Store and triggering network requests. It abstracts the complexity of state management and API interactions.
- The `UsersFacade` is also responsible for **smart caching** to avoid unnecessary network requests.
- The `UsersFacade` is also responsible for **reactive UI updates** using Angular Signals.
- The `UsersFacade` is also responsible for **strict separation of concerns** by hiding NgRx state from the UI components.
- The `UsersFacade` is also responsible for **testing** by providing a **mock implementation** for the `UserService`.
- The `UsersFacade` is also responsible for **performance optimization** by leveraging NgRx's **Entity** feature for normalized state management.
- The `UsersFacade` is also responsible for **modularization** by splitting the business logic into separate services and reusable functions.
- The `UsersFacade` supports all user CRUD opertaions for future enhancements, exposed via public apis.


## 📌 Summary

This project demonstrates:
* Scalable **Nx monorepo architecture**
* Clean **domain-driven library structure**
* **NgRx Entity + Selectors** for normalized state
* **WebSocket + NgRx Effects** for real-time order ingestion
* **Angular Signals** for reactive UI
* **Facade pattern** for strict separation of concerns
* Modern Angular features and best practices


## 🤖 AI-Assisted Development

- The system was designed by translating product requirements into a clear architectural model, including structure, boundaries, and implementation patterns.
- AI was used as an implementation accelerator to generate a strong initial baseline aligned with this architecture.
- The system was then refined iteratively through engineering-led review, testing, and targeted improvements.
- AI also supported architecture-aware reviews, helping identify performance risks and structural inconsistencies.
- Final design decisions, trade-offs, and code quality were owned and validated manually.

