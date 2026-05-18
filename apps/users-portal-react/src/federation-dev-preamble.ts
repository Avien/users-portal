// When React runs as a federation remote inside a non-Vite host (e.g. Angular),
// Vite's normal HTML transform never fires, so the React Fast Refresh preamble
// is never installed. Components throw at import time if the flag is missing.
// This module installs the minimum stubs so components render correctly.
// HMR won't work for the remote in this mode — that's expected.
if (typeof window !== 'undefined') {
  (window as any).__vite_plugin_react_preamble_installed__ = true;
  (window as any).$RefreshReg$ ??= () => {};
  (window as any).$RefreshSig$ ??= () => (type: unknown) => type;
}