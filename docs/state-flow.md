# State Flow & Library Structure — Deep Dive

[← Back to README](../README.md)

## Framework implementations of the Facade pattern

**Angular — `UsersFacade` (class, root-scoped DI)**

Exposed as a single Angular Signal `$vm` — the component reads one object and re-renders when it changes. Route lifecycle (loading users, selecting from URL) is delegated to `selectUserResolver` and `autoSelectUserGuard` — the component has no `ngOnInit` at all.

* UI components only read `$vm` — no actions, no selectors, no subscriptions
* Route guards and resolvers drive initialization, not the component
* Facade is globally singleton via `providedIn: 'root'`

**React — `useUsersFacade()` (hook, component-scoped)**

Same role, idiomatic React form: composes TanStack Query + Zustand and returns `UserOrdersVm & IUsersFacadeInteractions` as a plain object. Components are unaware of either library. Because hooks are naturally component-scoped, the React facade doesn't need DI — it IS the DI boundary.

* URL (`useParams`) is the source of truth for `selectedUserId` — no Zustand for selection
* `useNavigate` is the write path for `selectUser` — navigation IS the state update
* `useMemo` inside the facade replaces NgRx memoised selectors
* `React.memo` on UI components replaces `OnPush`

**Shared contract** — both facades return the same shape, enforced by `@portal/users/utils`:
```ts
UserOrdersVm & IUsersFacadeInteractions
// selectUser(id), dismissOrderNotification(id) — identical public surface
```

Swapping the entire state management stack (Angular NgRx ↔ React TanStack+Zustand) had zero impact on the presentational components — they consume the same contract either way.

---

## State Flow — Angular

```text
User Interaction
  ↓
Feature Component (pure view)
  ↓
UsersFacade.selectUser()
  ↓
Router.navigate(['/users', id])          ← selectUserResolver fires
  ↓
NgRx Actions (selectUser, loadUserOrders)
  ↓
Effects (API calls + WS stream mapping)
  ↓
Reducers (state updates)
  ↓
Selectors (memoised derivations)
  ↓
Angular Signals ($vm)
  ↓
UI Rendering
```

WebSocket path:
```text
WS event (OrdersService / RxJS webSocket)
  ↓
NgRx Effect → mergeOrderIntoCache action
  ↓
Reducer → per-user orders updated
  ↓
reduceOrderMonitoring (shared pure util)
  ↓
NgRx Effect → addNotification action
  ↓
$vm.notifications signal → ToastStack
```

---

## State Flow — React

```text
User Interaction
  ↓
UI Component (React.memo — props only)
  ↓
selectUser() callback
  ↓
useNavigate() → URL update (/users/:id)
  ↓
useParams() re-reads selectedUserId
  ↓
useQuery (TanStack) fetches orders for id
  ↓
useMemo (facade) derives UserOrdersVm
  ↓
UI Rendering
```

WebSocket path (singleton, runs in App):
```text
useOrdersStream() — mounted once in <App>
  ↓
WebSocket message
  ↓
queryClient.setQueryData → per-user cache updated
  ↓ (if user not yet visited → pendingByUser buffer)
reduceOrderMonitoring (shared pure util)
  ↓
Zustand addNotification
  ↓
useUsersFacade reads notifications from store
  ↓
vm.notifications → ToastStack
```

---

## Domain-Driven Library Structure

The workspace is split into framework-specific libs under a shared domain root. Module boundary rules (Nx ESLint `@nx/enforce-module-boundaries`) are enforced via `type:` tags (layer direction) and `framework:` tags (no cross-framework imports).

```text
apps/
  portal-shell           → Vanilla JS landing page (no build step)
  users-portal-angular   → Angular app shell + MFE host (/hybrid route)
  users-portal-react     → React app shell + MFE remote (exposes mount())

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

### Layer Rules (both apps)

| `type:` tag | Can depend on |
| :--- | :--- |
| `app` | `feature`, `data-access` |
| `feature` | `ui`, `data-access`, `utils` |
| `data-access` | `utils` |
| `ui` | `utils` |
| `utils` | `utils` |

### Framework Isolation Rules

| `framework:` tag | Projects |
| :--- | :--- |
| `framework:angular` | `users-portal-angular`, `users-angular/data-access`, `users-angular/feature`, `users-angular/ui` |
| `framework:react` | `users-portal-react`, `users-react/data-access`, `users-react/feature`, `users-react/ui` |
| `framework:shared` | `users/utils` |

Angular and React libs must never import from each other. Only `framework:shared` libs may be imported by both.
