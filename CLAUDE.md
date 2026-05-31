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
  portal-shell/             ← Vanilla JS landing page / MFE shell (no build step, port 4000)
  users-portal-angular/     ← Angular app + MFE host (touch only when adding shared contracts)
  users-portal-react/       ← React app + MFE remote (actively developed)

libs/
  users/  (@portal/users/utils)   ← framework-agnostic, shared by BOTH apps
                                     Pure TS — domain models, pure utils, canonical mock data

  users-angular/            ← Angular-specific only
    data-access/ (@portal/users-angular/data-access) ← NgRx store, effects, facade
    ui/          (@portal/users-angular/ui)           ← Angular presentational components
    feature/     (@portal/users-angular/feature)      ← Angular smart container

  users-react/              ← React-specific only
    data-access/ (@portal/users-react/data-access) ← TanStack Query, Zustand store, API fns, useOrdersStream
    feature/     (@portal/users-react/feature)     ← useUsersFacade hook
    ui/          (@portal/users-react/ui)           ← React presentational components (incl. virtual scroll)
```

---

## Shared Contracts (libs/users/utils → @portal/users/utils)

These interfaces are the single source of truth for both Angular and React:

- `UserOrdersVm` — the ViewModel shape both facades must return
- `IUsersFacadeInteractions` — the user-interaction contract both facades must implement
  - `selectUser(id: number): void`
  - `dismissOrderNotification(id: string): void`
  - NOTE: `loadUsers()` is intentionally absent — Angular dispatches NgRx action, React uses TanStack Query automatically
- `User`, `Order`, `Notification`, `UserOrderSummary` — domain models
- `reduceOrderMonitoring`, `buildUserTotalOrdersVm` — pure domain logic shared by both facades

**Rules:**
- Never duplicate these types in app code — always import from `@portal/users/utils`
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
npm run start:angular      # serve Angular app (http://localhost:4200)
npm run start:react        # serve React app (http://localhost:4201)
npm run start:shell        # serve vanilla JS shell (http://localhost:4000)
npm run mock:ws            # start local WS mock server at ws://localhost:3000/orders

npm run validate           # lint + test all projects
npm run validate:angular   # lint + test Angular projects + shared (tag:framework:angular + tag:framework:shared)
npm run validate:react     # tsc --noEmit + lint + test React projects + shared (tag:framework:react + tag:framework:shared)

npm run build:prod         # alias for build:angular (Vercel Angular deployment)
npm run build:angular      # validate:angular → nx build users-portal-angular → dist/apps/users-portal-angular
npm run build:react        # validate:react   → nx build users-portal-react   → dist/users-portal-react

npm run g:feature-domain -- <name>  # scaffold new dual-framework feature domain (see Generator section)
```

## Generator — New Feature Domain

Use the `feature-domain` generator when scaffolding a **brand-new domain** (not a component or util — for those use `/new-component` and `/sync-contract`).

```bash
npm run g:feature-domain -- <domain-name>
```

What it generates from a single command:

| Output | Contents |
|---|---|
| `libs/<name>/` | Shared contract — model interface, `I<Name>FacadeInteractions`, `<Name>Vm`, mock data |
| `libs/<name>-angular/data-access/` | NgRx actions → reducer → effects → selectors + `<Name>Facade implements I<Name>FacadeInteractions` (Angular Signals, `inject()`) |
| `libs/<name>-react/data-access/` | `fetch<Name>()` API fn + Zustand store for UI-only state |
| `libs/<name>-react/feature/` | `use<Name>Facade()` hook returning `<Name>Vm & I<Name>FacadeInteractions` |

Also updates `tsconfig.base.json` with all 4 path aliases automatically.

**Rules after generating:**
- Fill in the `<Name>` model interface in `libs/<name>/src/lib/models/<name>.interface.ts`
- Replace `MOCK_<NAME>` array in `libs/<name>/src/lib/mocks/mock-data.ts` with real mock data
- Add domain-specific interaction methods to `I<Name>FacadeInteractions` then implement in both facades
- Run `npm run validate:angular && npm run validate:react` before committing

**When NOT to use the generator:**
- Adding a new component → `/new-component`
- Adding a field or method to an existing shared contract → `/sync-contract`
- The generator is for new domains only — it creates the full lib structure from scratch

## Module Boundary Tags

Every `project.json` carries a `framework:` tag used by ESLint `@nx/enforce-module-boundaries` and the scoped validate/build scripts:

| Tag | Projects |
|---|---|
| `framework:angular` | `users-portal-angular`, `users-data-access`, `users-feature`, `users-ui` |
| `framework:react` | `users-portal-react`, `users-react-data-access`, `users-react-feature`, `users-react-ui` |
| `framework:shared` | `users-utils` |

The existing `type:` tags (app, feature, data-access, ui, utils) enforce layer direction for both frameworks simultaneously.
