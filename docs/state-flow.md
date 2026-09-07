# State Flow & Library Structure — Deep Dive

[← Back to README](../README.md)

Angular, React, and Vue implement the same semantic VM/interactions contract defined by `UserOrdersVm` and `IUsersFacadeInteractions`, exposed idiomatically per framework. This doc walks through each framework's facade internals and diagrams how a user interaction and a WebSocket event each flow through it, end to end.

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

**Vue — `useUsersFacade()` (composable, component-scoped)**

Same role again, idiomatic Vue form: composes TanStack Vue Query + Pinia and returns a `ComputedRef` per `UserOrdersVm` field plus the plain `IUsersFacadeInteractions` methods. Components read refs, never the underlying query or store directly.

* URL (`vue-router`'s `useRoute()`) is the source of truth for `selectedUserId` — the same pattern as React's `useParams`, no Pinia state for selection
* `useRouter().push()` is the write path for `selectUser` — navigation IS the state update, the same shape as React's `useNavigate`
* `computed()` inside the facade replaces NgRx memoised selectors / React's `useMemo`
* Vue's fine-grained reactivity tracks each `computed()` ref directly — no `OnPush`/`React.memo` equivalent needed

**Shared contract** — all three facades implement the same semantic `UserOrdersVm & IUsersFacadeInteractions` contract, exposed idiomatically per framework (Vue wraps each VM field as a `ComputedRef`, Angular emits one aggregate Signal, React returns plain values — interaction methods are plain functions in all three), enforced by `@portal/users/utils`:
```ts
UserOrdersVm & IUsersFacadeInteractions
// selectUser(id), dismissOrderNotification(id) — identical public surface
```

In each framework, the presentational layer is insulated from the state-management implementation and consumes only facade-derived data and callbacks — three parallel implementations (Angular NgRx, React TanStack+Zustand, Vue TanStack Vue Query+Pinia), not one set of components surviving a literal state-library swap.

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

## State Flow — Vue

```text
User Interaction
  ↓
UI Component (template — props only)
  ↓
selectUser() callback
  ↓
useRouter().push() → URL update (/users/:id)
  ↓
useRoute() re-reads selectedUserId
  ↓
useQuery (TanStack Vue Query) fetches orders for id
  ↓
computed() (facade) derives UserOrdersVm
  ↓
UI Rendering
```

WebSocket path (singleton, runs once at the app root):
```text
useOrdersStream() — mounted once in <App>
  ↓
WebSocket message
  ↓
queryClient.setQueryData → per-user cache updated
  ↓ (if user not yet visited → pendingByUser buffer)
reduceOrderMonitoring (shared pure util)
  ↓
Pinia addNotification
  ↓
useUsersFacade reads notifications from store
  ↓
vm.notifications → ToastStack
```

> The domain-driven library structure, layer rules, and framework isolation tags now live directly in the main [README](../README.md#domain-driven-library-structure).
