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
npm run start:angular      # serve Angular app (http://localhost:4200) + WS mock + local Business Agent server, in parallel via concurrently
npm run start:react        # serve React app (http://localhost:4201) + WS mock + local Business Agent server, in parallel via concurrently
npm run start:vue          # serve Vue app (http://localhost:4202) + WS mock + local Business Agent server, in parallel via concurrently
npm run start:shell        # serve vanilla JS shell (http://localhost:4000)
npm run mock:ws            # start local WS mock server at ws://localhost:3000/orders (standalone; bundled into start:react already)
npm run business-agent     # start the local Business Agent server at http://localhost:8787 (standalone; bundled into start:react already)

npm run validate           # lint + test all projects
npm run validate:angular   # lint + test Angular projects + shared (tag:framework:angular + tag:framework:shared)
npm run validate:react     # tsc --noEmit + lint + test React projects + shared (tag:framework:react + tag:framework:shared)

npm run build:prod         # Vercel Angular deployment command — build:angular, or build:angular:preview when $VERCEL_ENV=preview
npm run build:angular      # validate:angular → nx build users-portal-angular → dist/apps/users-portal-angular
npm run build:angular:preview # Vercel Preview build — generates environment.preview.ts (gitignored) from Preview-scoped VITE_ORDERS_API_URL / VITE_ORDERS_WS_URL / VITE_REACT_REMOTE_URL, then nx build --configuration=preview
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

---

## Claude Model Selection

Model choice should be deliberate, not reflexive. Default to Sonnet 5; escalate only when the reasoning itself — not the task's size or file count — warrants it.

### Sonnet 5 — default

The normal model for repository work: ordinary implementation once architecture is agreed, small/medium bug fixes, adding/updating tests, routine refactors within established boundaries, README/docs/comments, type/lint/build fixes, repo/file inspection, straightforward debugging, implementing an already-approved plan, routine framework-adapter work, and configuration changes whose desired behavior is already unambiguous.

Do not escalate merely because a task is large, touches many files, or the word "architecture" appears.

### Opus 5 — difficult engineering / architecture

Use when deeper reasoning can materially reduce architectural or correctness risk: choosing between materially different architecture approaches, Senior/Staff/Principal-level architecture review, changing public contracts, cross-framework architecture decisions, Nx/library boundary decisions, difficult Angular/React/Vue state-flow problems, subtle HTTP/WebSocket race/concurrency problems, Module Federation / Hybrid MFE architecture issues, LLM agent-loop or tool-contract design, security-boundary decisions, Preview/Production deployment-topology decisions, difficult bugs with unclear root cause, or reviewing whether an implementation drifted from this repo's established architecture.

Escalate because the reasoning is difficult or consequential — not because the task touches many files.

### Fable 5 — rare, whole-system / adversarial review

Reserve for unusually broad or difficult whole-system reasoning: a final adversarial review of a major PR before merge, reviewing the complete system from scratch for hidden flaws, challenging architecture assumptions established earlier, tracing subtle interactions across frontend state / backend state / WebSockets / MFE / deployment / security / LLM agent behavior, exceptionally difficult problems Sonnet/Opus haven't resolved, or long-horizon Principal-Architect analysis across many subsystems.

Not for normal coding, routine tests, docs, simple bug fixes, mechanical refactors, or straightforward implementation — this is an occasional independent deep-review model, not an implementation default. For an adversarial review, default to **report-only**: inspect, challenge assumptions, classify findings, and don't modify code unless explicitly approved afterward.

### Haiku 4.5 — lightweight only

Use only when speed matters more than depth: simple searches, trivial text/formatting edits, obvious repetitive transformations, quick explanations, small mechanical tasks. Never for architecture, security, concurrency, state consistency, agent design, deployment topology, substantial debugging, or meaningful code review.

### Escalation flow

```
Sonnet 5 → (meaningful ambiguity / difficult engineering / architectural risk) → Opus 5
        → (exceptionally difficult whole-system problem or final adversarial audit) → Fable 5
```

Escalate based on reasoning difficulty, ambiguity, architectural impact, correctness/security risk, and the cost of getting the decision wrong — never merely because the task is long, touches many files, or "sounds architectural."

### Switching models mid-task

If the current task materially deserves a stronger model than the one active:
1. Continue routine/non-consequential inspection until the next natural decision boundary — don't interrupt mid-command.
2. At that boundary, say briefly: *"I recommend switching from `<current model>` to `<recommended model>` for the next step because `<specific reason>`."*
3. Wait for the switch before the next consequential architectural/implementation decision.

If the current model is sufficient, don't discuss model choice at all — and don't repeatedly remind which model is active.

### Project-specific examples

| Model | Example tasks in this repo |
|---|---|
| Sonnet 5 | Business Agent docs, README updates, straightforward unit tests, comment fixes, implementing an already-approved solution, normal Angular/React/Vue adapter changes, implementing an already-approved bounded demo-order retention rule |
| Opus 5 | Deciding retention count-based vs. TTL vs. persistence, difficult REST/WS race analysis, changing the shared Web Component's public contract, changing Business Agent tool architecture, changing MFE host/remote architecture, changing Preview/Production deployment topology, security-sensitive design choices, Senior Architect review of a substantial feature |
| Fable 5 | Final adversarial review of a large PR, a "what did the previous reviews miss?" whole-system audit, independent challenge of assumptions across the entire architecture |
| Haiku 4.5 | Trivial searches, simple mechanical edits, low-risk repetitive changes |

### Model choice does not change permission rules

A stronger model is not license to redesign approved architecture, introduce new frameworks/services/dependencies/infrastructure, change public contracts, weaken security, alter deployment topology, modify external/persistent data, commit/push/merge/rebase/reset/force-push, make paid external API calls beyond approved verification, or broaden feature scope. Routine commands required by an already-approved plan proceed without command-by-command permission; consequential architectural/product/security/deployment decisions still require explicit approval, regardless of which model is active.
