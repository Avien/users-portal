# Claude Code — Project Rules

## Project Overview

Nx monorepo containing two parallel implementations of the same domain:
- `apps/users-portal-angular` — Angular 19, NgRx, Signals, OnPush (reference implementation, do not break)
- `apps/users-portal-react` — React 19, Vite (learning rebuild, actively developed)

**Goal:** Rebuild the Angular app in React idiomatically. Do not translate Angular patterns directly — find the React equivalent. The Angular app is the architectural reference, not the template.

---

## Workspace Structure

```
apps/
  users-portal-angular/     ← Angular app (touch only when adding shared contracts)
  users-portal-react/       ← React app (actively developed)

libs/
  users/
    utils/      (@fmr/users/utils)       ← Pure TS, no framework deps — shared by BOTH apps
    data-access/ (@fmr/users/data-access) ← Angular NgRx store, effects, facade
    ui/          (@fmr/users/ui)          ← Angular presentational components
    feature/     (@fmr/users/feature)     ← Angular smart container
```

## Planned React Libs (not yet generated)

```
libs/
  users-react/
    data-access/ (@fmr/users-react/data-access) ← TanStack Query, Zustand store, API functions
    feature/     (@fmr/users-react/feature)      ← useUsersFacade hook (currently in app)
    ui/          (@fmr/users-react/ui)            ← React presentational components
```

These will be generated when TanStack Query and Zustand are introduced. Code currently in `apps/users-portal-react/src/app/feature/` will move here.

---

## Shared Contracts (libs/users/utils)

These interfaces are the single source of truth for both Angular and React:

- `UserOrdersVm` — the ViewModel shape both facades must return
- `IUsersFacadeInteractions` — the user-interaction contract both facades must implement
  - `selectUser(id: number): void`
  - `dismissOrderNotification(id: string): void`
  - NOTE: `loadUsers()` is intentionally absent — Angular dispatches NgRx action, React uses TanStack Query automatically
- `User`, `Order`, `Notification`, `UserOrderSummary` — domain models

**Rules:**
- Never duplicate these types in app code — always import from `@fmr/users/utils`
- When adding new shared contracts, add to utils first, then implement in both apps
- Angular `UsersFacade implements IUsersFacadeInteractions` — keep this in sync

---

## Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Files | kebab-case | `use-users-facade.ts` |
| Component exports | PascalCase | `export const UsersTable` |
| Hook exports | camelCase, `use` prefix | `export function useUsersFacade` |
| Facade hook files | `use-[name]-facade.ts` | `use-users-facade.ts` |
| Interface files | kebab-case | `users-facade.interactions.ts` |
| Shared interfaces | `I` prefix | `IUsersFacadeInteractions` |

---

## npm Scripts

```bash
npm start              # serve Angular app
npm run start:react    # serve React app (http://localhost:4200 or 4201)
npm run validate       # lint + test both apps
```
