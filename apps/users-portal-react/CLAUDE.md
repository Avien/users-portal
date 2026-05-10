# Claude Code — React App Rules

Inherits workspace rules from `/CLAUDE.md`. This file covers React-specific conventions.

---

## Current Implementation Status

### Done
- [x] Core rendering — components, props, state, callbacks, re-render tracing
- [x] Memoization — `React.memo`, `useMemo`, `useCallback`
- [x] `useEffect` — async data loading, cleanup, cancelled flag pattern
- [x] Custom hook — `useUsersFacade` (facade pattern)
- [x] Shared contracts — `UserOrdersVm & IUsersFacadeInteractions` from utils
- [x] `StrictMode` temporarily removed for render tracing (restore before next phase)

### In Progress / Planned
- [x] TanStack Query — `useQuery` for users + orders per user, `QueryClientProvider` in main.tsx
- [ ] Zustand — global UI state (`selectedUserId`, `notifications`)
- [ ] `useUsersFacade` → promote to `libs/users-react/feature/`
- [ ] Orders fetch per selected user (currently hardcoded ORDERS constant)
- [ ] WebSocket stream for live order updates
- [ ] Order monitoring logic (burst detection, high-value alerts)
- [ ] Toast notifications (`notifications` field in VM)
- [ ] React Router — route-based navigation
- [ ] Nx lib generation for `users-react/data-access`, `feature`, `ui`

---

## Architecture Rules

### Layer Responsibilities

| Layer | Lives in | Rule |
|---|---|---|
| Domain models | `@fmr/users/utils` | Pure TS, no framework, shared with Angular |
| API functions | `users-react/data-access/api/` | Plain async functions, no React |
| Zustand store | `users-react/data-access/store/` | UI state only — selectedUserId, notifications |
| TanStack Query hooks | `users-react/data-access/hooks/` | Server state — fetch, cache, loading, error |
| Facade hook | `users-react/feature/` | Composes data-access, returns `UserOrdersVm & IUsersFacadeInteractions` |
| Smart component | App or feature | Calls `useUsersFacade()`, passes props down |
| Presentational component | `users-react/ui/` | Props in, JSX out, no hooks beyond `memo` |

### Strict Layer Boundaries
- Components never filter, sort, map, or derive data — that belongs in the facade hook
- Facade hook owns all `useMemo` derivations (equivalent to NgRx selectors)
- API functions are plain async — no React hooks, no Zustand
- Utils lib must remain free of React and Angular imports

---

## React Conventions

### Memoization Rules
- Wrap presentational components in `React.memo`
- `useMemo` for any derived value (filtered/sorted arrays) passed to memo'd children
- `useCallback` only for **wrapper functions** — not for `useState` setters (already stable)
- Do NOT memoize primitives or trivial expressions — overhead exceeds benefit
- Smart components (call hooks, own subscriptions) are generally NOT wrapped in `React.memo`

### useState
- Each `useState` call occupies a fixed fiber slot — never call hooks conditionally
- Initial value is used only once — subsequent renders read current fiber state
- Setters are stable references — pass directly without `useCallback` wrapping

### useEffect
- `useEffect(() => { ... }, [])` — runs once after mount (≈ ngOnInit + ngOnDestroy)
- Always use a `cancelled` flag for async operations to prevent state updates on unmounted components
- Cleanup function (returned function) runs before next effect and on unmount
- Dependency array must be exhaustive — never suppress exhaustive-deps warnings silently

### Component Structure
```
component-name/
  component-name.tsx     ← component + private sub-components in same file if not reused
```
Private sub-components (used only by their parent) live in the same file — not a separate file per component like Angular enforces.

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
| NgRx Effect + Service | TanStack Query `queryFn` |
| `ngOnInit` | `useEffect(() => ..., [])` |
| `ngOnDestroy` | Cleanup function returned from `useEffect` |
| `OnPush` component | `React.memo(Component)` |
| Pipe (pure transform) | Plain utility function or `useMemo` |
| `@Input()` | Props |
| `@Output() EventEmitter` | Callback prop `(value: T) => void` |
| `trackBy` in `*ngFor` | `key` prop in `.map()` |
| `DestroyRef.onDestroy` | `useEffect` cleanup function |

---

## What NOT to Put in JSX

React's JSX is just JavaScript — resist the temptation to embed logic inline.

```tsx
// WRONG — filter/sort/derive inside JSX
{orders.filter(o => o.userId === id).map(o => <Item key={o.id} order={o} />)}

// RIGHT — facade hook derives, component receives clean data
{orders.map(o => <Item key={o.id} order={o} />)}
```

Transformation logic belongs in the facade hook (`useMemo`), utility functions (`@fmr/users/utils`), or formatting helpers — never inline in JSX.
