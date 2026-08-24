// Pure ambient .d.ts (JSX typing augmentation only, no runtime export) — a real
// `import` statement here breaks Vite/Vitest, which try to resolve and bundle
// it as a real module and fail since no .js/.ts companion exists.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./lib/business-agent-widget-elements.d.ts" />
export { BusinessAgentPanel } from './lib/business-agent-panel';
