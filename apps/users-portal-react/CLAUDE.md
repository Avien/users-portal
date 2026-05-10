# Claude Code — React App Rules

Inherits workspace rules from `/CLAUDE.md`. This file covers React-specific conventions.

---

## Current Implementation Status

### Done
- [x] Core rendering — components, props, state, callbacks, re-render tracing
- [x] Memoization — `React.memo`, `useMemo`, `useCallback`
- [x] `useEffect` — async data loading, cleanup, cancelled flag pattern
- [x] TanStack Query — `useQuery` for users + orders per user, `staleTime: Infinity` on orders
- [x] Zustand store — `selectedUserId`, `notifications`, `addNotification` with auto-dismiss timers
- [x] `useUsersFacade` — facade hook in `libs/users-react/feature/`, returns `UserOrdersVm & IUsersFacadeInteractions`
- [x] Shared contracts — `UserOrdersVm & IUsersFacadeInteractions` from `@portal/users/utils`
- [x] WebSocket stream — `useOrdersStream` in `libs/users-react/data-access`, called from `App`
- [x] Pending buffer — `drainPendingOrders` merges WS orders for unvisited users after API load
- [x] Order monitoring — `reduceOrderMonitoring` (shared pure util) drives high-value/burst notifications
- [x] Toast notifications — `ToastStack` component, wired through facade `notifications` field
- [x] Virtual scroll — `@tanstack/react-virtual` on the orders list (8-row viewport, 52px fixed row height)
- [x] Nx libs — `users-react/data-access`, `feature`, `ui` all generated and tagged

### Planned
- [ ] React Router — route-based navigation

---

## Architecture Rules

### Layer Responsibilities

| Layer | Lives in | Rule |
|---|---|---|
| Domain models + mock data | `@portal/users/utils` | Pure TS, no framework, shared with Angular |
| API functions | `users-react/data-access/api/` | Plain async functions, no React |
| Zustand store | `users-react/data-access/store/` | UI state only — selectedUserId, notifications |
| WebSocket hook | `users-react/data-access/stream/` | Singleton side-effect, called once from App |
| Facade hook | `users-react/feature/` | Composes data-access, returns `UserOrdersVm & IUsersFacadeInteractions` |
| Smart component | App or feature | Calls `useUsersFacade()`, passes props down |
| Presentational component | `users-react/ui/` | Props in, JSX out, no hooks beyond `memo` and `useRef` for virtualizer |

### Strict Layer Boundaries
- Components never filter, sort, map, or derive data — that belongs in the facade hook
- Facade hook owns all `useMemo` derivations (equivalent to NgRx selectors)
- API functions are plain async — no React hooks, no Zustand
- `useOrdersStream` is infrastructure — call it from `App`, not from the facade
- Utils lib must remain free of React and Angular imports

---

## Key React ↔ Angular Decisions

### Server State vs UI State
- **TanStack Query** owns server state (users list, per-user orders cache)
- **Zustand** owns UI state (selected user, notifications)
- `staleTime: Infinity` on orders — WebSocket is the freshness mechanism, not polling

### WebSocket as Singleton Side Effect
Angular handles this via NgRx Effects (automatically singleton). In React it must be explicit:
- `useOrdersStream()` is called once in `App`, not in any component tied to user selection
- Module-level `pendingByUser` Map persists across component lifecycle — WS orders for unvisited users are buffered, merged by the facade `useEffect` after `ordersQuery.isSuccess`

### Notifications / Auto-dismiss
Angular uses `OrderNotificationsService` (a class). React equivalent:
- Zustand `addNotification` / `dismissNotification` actions in `users.store.ts`
- Module-level `dismissTimers` Map (outside Zustand state) mirrors the service's timer ownership

---

## React Conventions

### Memoization Rules
- Wrap presentational components in `React.memo`
- `useMemo` for any derived value (filtered/sorted arrays) passed to memo'd children
- `useCallback` only for **wrapper functions** — not for `useState` setters (already stable)
- Do NOT memoize primitives or trivial expressions — overhead exceeds benefit
- Smart components (call hooks, own subscriptions) are generally NOT wrapped in `React.memo`

### useEffect
- Dependency array must be exhaustive — never suppress exhaustive-deps warnings silently
- Cleanup function runs before next effect and on unmount — always clean up WS connections and timers

### Testing with TanStack Query
Always set `gcTime: 0` in test `QueryClient` instances — the default 5-minute GC timer keeps vitest alive after tests finish:
```ts
new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
```
Use `vi.useFakeTimers()` / `vi.useRealTimers()` in any spec that triggers Zustand `addNotification` (creates auto-dismiss `setTimeout`).

### Component Structure
```
component-name/
  component-name.tsx     ← component + private sub-components in same file if not reused
```

---

## Angular → React Mental Model Reference

| Angular | React |
|---|---|
| `@Injectable({ providedIn: 'root' })` | Zustand store (module-scope singleton) |
| `UsersFacade` class | `useUsersFacade()` hook |
| `$vm: Signal<UserOrdersVm>` | Return value of `useUsersFacade()` |
| `computed(() => ...)` | `useMemo(() => ..., [deps])` |
| `effect(() => ...)` | `useEffect(() => ..., [deps])` |
| NgRx selector | `useMemo` derivation inside facade hook |
| NgRx Effect + Service (API) | TanStack Query `queryFn` |
| NgRx Effect + Service (WS) | `useOrdersStream()` called from `App` |
| `OrderNotificationsService` | Zustand `addNotification` + module-level `dismissTimers` Map |
| `ngOnInit` | `useEffect(() => ..., [])` |
| `ngOnDestroy` | Cleanup function returned from `useEffect` |
| `OnPush` component | `React.memo(Component)` |
| Pipe (pure transform) | Plain utility function or `useMemo` |
| `@Input()` | Props |
| `@Output() EventEmitter` | Callback prop `(value: T) => void` |
| `trackBy` in `*ngFor` | `key` prop in `.map()` |
| `DestroyRef.onDestroy` | `useEffect` cleanup function |
| `CdkVirtualScrollViewport` | `useVirtualizer` from `@tanstack/react-virtual` |

---

## What NOT to Put in JSX

React's JSX is just JavaScript — resist the temptation to embed logic inline.

```tsx
// WRONG — filter/sort/derive inside JSX
{orders.filter(o => o.userId === id).map(o => <Item key={o.id} order={o} />)}

// RIGHT — facade hook derives, component receives clean data
{orders.map(o => <Item key={o.id} order={o} />)}
```

Transformation logic belongs in the facade hook (`useMemo`), utility functions (`@portal/users/utils`), or formatting helpers — never inline in JSX.
