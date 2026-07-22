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

> The domain-driven library structure, layer rules, and framework isolation tags now live directly in the main [README](../README.md#-domain-driven-library-structure).
