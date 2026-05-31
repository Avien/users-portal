Audit the React implementation for architecture drift — violations of layer boundaries, naming conventions, and the shared contract rules defined in CLAUDE.md.

## What to check

### 1. Layer boundary violations
Scan `libs/users-react/` and `apps/users-portal-react/src/` for:
- **UI components importing from Zustand or TanStack Query** — presentational components must be props-only
- **API functions (`data-access/api/`) importing React hooks** — must be plain async functions
- **Facade hook (`feature/`) doing direct fetch calls** — must delegate to TanStack Query, not fetch directly
- **`useOrdersStream` called anywhere except `App`** — it's a singleton side-effect, one call site only
- **Cross-framework imports** — any `@portal/users-angular/*` import in React code (or vice versa)

### 2. Shared contract drift
- Are all domain types imported from `@portal/users/utils`? Grep for locally redefined `User`, `Order`, `Notification`, `UserOrdersVm`
- Does `useUsersFacade` return both `UserOrdersVm` and `IUsersFacadeInteractions`?
- Are `selectUser` and `dismissOrderNotification` present and matching the interface signatures?

### 3. Naming convention violations
- Files: must be kebab-case
- Component exports: must be PascalCase
- Hook exports: must start with `use` — only applies to files named `use-*.ts` or `use-*.tsx`; plain utility functions and API functions are exempt
- Facade files: must follow `use-[name]-facade.ts`

### 4. JSX logic violations
Scan `.tsx` files for inline derivations in JSX:
- `.filter(` inside JSX return
- `.sort(` inside JSX return
- `.map(` chained after `.filter(` inside JSX return
These belong in the facade hook (`useMemo`), not in the template.

### 5. Zustand state scope
- `selectedUserId` must NOT be in Zustand — it lives in the URL (React Router `useParams`)
- Zustand store must only contain `notifications`, `addNotification`, `dismissNotification`

## Output format

Report findings grouped by category. For each violation:
- File path + line number
- What the violation is
- What the correct pattern is

End with a pass/fail summary per category. If everything is clean, say so explicitly.