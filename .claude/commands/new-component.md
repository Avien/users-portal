Create a new presentational component following all project conventions.

Arguments: $ARGUMENTS
(e.g. "user-badge react" or "order-summary angular")

If no framework is specified in the arguments, ask the user before proceeding.

---

## React component — `libs/users-react/ui/`

### Files to create
```
libs/users-react/ui/src/lib/<component-name>/
  <component-name>.tsx
```

### Rules
- Wrap in `React.memo` — presentational components are always memoized
- Props interface named `<ComponentName>Props`
- No hooks beyond `useRef` (only if needed for virtualizer)
- No data fetching, no Zustand, no TanStack Query — props in, JSX out
- Import domain types from `@portal/users/utils`, never redefine them
- No inline derivations in JSX (no `.filter(`, `.sort(` in the return block)

### Template
```tsx
import { memo } from 'react';

interface <ComponentName>Props {
  // props here
}

export const <ComponentName> = memo(function <ComponentName>({}: <ComponentName>Props) {
  return (
    <div>
      {/* content */}
    </div>
  );
});
```

### Wire up
Add export to `libs/users-react/ui/src/index.ts`

---

## Angular component — `libs/users-angular/ui/`

### Files to create
```
libs/users-angular/ui/src/lib/<component-name>/
  <component-name>.component.ts
  <component-name>.component.html
  <component-name>.component.scss
```

### Rules
- `standalone: true`, `changeDetection: ChangeDetectionStrategy.OnPush` — always
- Inputs use Angular 19 signal API: `readonly myProp = input<Type>(defaultValue)`
- Outputs use signal API: `readonly myEvent = output<Type>()`
- No `NgRx` injection — presentational components receive data via inputs only
- Import domain types from `@portal/users/utils`, never redefine them
- `trackBy` function required for any `*ngFor` over domain arrays

### Template
```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: '<component-name>',
  standalone: true,
  templateUrl: './<component-name>.component.html',
  styleUrl: './<component-name>.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class <ComponentName>Component {
  // readonly myProp = input<Type>(defaultValue);
}
```

### Wire up
Add export to `libs/users-angular/ui/src/index.ts`

---

## What NOT to do (either framework)
- Do not place in `apps/` — that is the app shell only
- Do not import across frameworks (`@portal/users-angular/*` in React or vice versa)
- Do not add state management — the facade hook / NgRx facade owns all state
- Do not redefine domain types locally — always import from `@portal/users/utils`