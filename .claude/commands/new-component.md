Create a new React presentational component in `libs/users-react/ui/` following all project conventions.

Component name: $ARGUMENTS

## Steps

1. **Determine the layer** — this is a presentational component, so it lives in `libs/users-react/ui/src/lib/`.
   - If the component is a smart container (calls hooks, owns data fetching), it belongs in `libs/users-react/feature/` instead — confirm with the user before proceeding.

2. **Create the folder and file** following the naming convention:
   ```
   libs/users-react/ui/src/lib/<component-name>/
     <component-name>.tsx
   ```
   - Folder and file: kebab-case
   - Export: PascalCase

3. **Scaffold the component** with these rules applied by default:
   - Wrap in `React.memo` — it's a presentational component
   - Props interface named `<ComponentName>Props`
   - No hooks beyond `useRef` (only if needed for virtualizer)
   - No data fetching, no Zustand, no TanStack Query — props in, JSX out
   - No inline derivations in JSX — if data needs filtering/mapping, it must arrive pre-derived via props
   - Import types from `@portal/users/utils` if they relate to domain models (never redefine them)

4. **Export from the ui lib index** — add the export to `libs/users-react/ui/src/index.ts`

5. **Show the user** the created file and confirm the export is wired up.

## Template

```tsx
import { memo } from 'react';

interface <ComponentName>Props {
  // props here
}

export const <ComponentName> = memo(function <ComponentName>({ }: <ComponentName>Props) {
  return (
    <div>
      {/* component content */}
    </div>
  );
});
```

## What NOT to do
- Do not put this in `apps/users-portal-react/src/` — that is app shell only
- Do not import from `@portal/users-angular/*` — framework isolation
- Do not add `useState` or data fetching — that breaks the presentational contract
- Do not create a separate CSS file unless the user asks — colocate styles or use inline if minimal