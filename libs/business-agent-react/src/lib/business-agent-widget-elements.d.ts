// Phase 3 host integration (see docs/roadmap.md). TypeScript doesn't know about
// custom elements by default — this teaches JSX about <business-agent-widget>,
// scoped to React since the widget itself (libs/business-agent-widget) is
// deliberately framework-free and must not know React exists.
//
// React 19 (`jsx: "react-jsx"`) resolves JSX.IntrinsicElements through the
// "react" module's own JSX namespace, not the classic global JSX namespace —
// so the augmentation has to target `declare module 'react'`, not `declare
// namespace JSX` at the top level.
//
// This file is a module (has a top-level import), so TypeScript won't pick it
// up automatically just by sitting next to business-agent-panel.tsx in another
// project's compilation — see the triple-slash reference in ./index.ts, which
// is what actually propagates this to consuming apps. Single source of truth:
// this file only, referenced from one place.
import 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'business-agent-widget': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        endpoint?: string;
      };
    }
  }
}
