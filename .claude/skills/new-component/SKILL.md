---
name: new-component
description: Create a new presentational Angular, React, or Vue component in the Users Portal repo. Use when asked to add or create a UI component inside an existing domain. Do not use for new business domains or data/state changes.
---

# New Component

Create the component according to this repository's architecture, not as free-form generated code.

## Workflow

1. Read `CLAUDE.md` first. It is the architectural source of truth.
2. Determine the target framework: Angular, React, or Vue. If it is not clear from the request or surrounding code, ask before changing files.
3. Inspect the nearest existing component in the same framework and UI library before creating anything.
4. Put the component in the framework-specific `ui` library, never directly in an app.
5. Keep the component presentational:
   - data comes in through inputs/props
   - interactions go out through outputs/callbacks/events
   - no API calls
   - no NgRx/Zustand/Pinia/TanStack Query access
   - import shared domain types from `@portal/users/utils`; do not redefine them locally
6. Follow the framework conventions below.
7. Export the component from the library public API.
8. Add or update focused tests when behavior is introduced.
9. Run the relevant framework validation before finishing.
10. Report the files changed and validation result.

## Framework conventions

### Angular
- Standalone component.
- `ChangeDetectionStrategy.OnPush`.
- Prefer signal `input()` / `output()` APIs.
- Keep state and data access in the facade/container layer.
- Track domain collections by stable identity.

### React
- Functional component with typed props.
- Use `memo` for presentational components where consistent with the existing UI library.
- No data fetching or application state access.
- Use stable `key` values for rendered domain collections.

### Vue
- Single-file component using `<script setup lang="ts">`.
- Typed `defineProps` and `defineEmits`.
- No data fetching or Pinia/vue-query access.
- Use stable `:key` values for `v-for`.

## Validation

Run the matching command:

- Angular: `npm run validate:angular`
- React: `npm run validate:react`
- Vue: `npm run validate:vue`

If the requested component would violate a module boundary or belongs in `feature` / `data-access` rather than `ui`, stop and explain the architectural mismatch instead of forcing it into the wrong layer.
