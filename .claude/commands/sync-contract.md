Add a new shared contract (type, interface, or pure function) to `@portal/users/utils` and implement it in both the Angular and React facades.

What to add: $ARGUMENTS

## Why this workflow exists

`libs/users/` is the single source of truth shared by both Angular and React. Never define domain types in app code — always add to utils first, then implement in both frameworks.

## Steps

### 1. Add to shared utils — `libs/users/src/lib/`
- If it's a **domain model** (entity shape): add to the appropriate models file
- If it's a **ViewModel or facade contract** (e.g. new field on `UserOrdersVm`, new method on `IUsersFacadeInteractions`): update the relevant interface
- If it's a **pure function** (derivation, calculation): add to utils, write a unit test alongside it
- Export from `libs/users/src/index.ts`

### 2. Implement in Angular facade — `libs/users-angular/data-access/src/lib/users.facade.ts`
- `UsersFacade implements IUsersFacadeInteractions` — keep in sync
- If adding a new action: dispatch NgRx action
- If adding a new selector: wire through `store.select()`
- If adding a new method to `IUsersFacadeInteractions`: implement it here

### 3. Implement in React facade — `libs/users-react/feature/src/lib/use-users-facade.ts`
- `useUsersFacade` returns `UserOrdersVm & IUsersFacadeInteractions`
- If adding a new derived value: add a `useMemo` derivation
- If adding a new action: add a `useCallback` wrapper (only if it wraps something, not for bare setters)
- If adding a new method to `IUsersFacadeInteractions`: implement it here

### 4. Run validate
```bash
npm run validate:angular
npm run validate:react
```
Both must pass before considering this done.

### 5. Report
Show a summary of every file touched and confirm both validates pass.

## Rules
- Never duplicate types between utils and app code
- The Angular and React implementations must satisfy the same interface — the shared contract is the contract
- Pure functions in utils must have no React or Angular imports