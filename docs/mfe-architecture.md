# Hybrid Microfrontend — Deep Dive

[← Back to README](../README.md)

The Hybrid mode runs React inside Angular using **Module Federation 2.0** — no iframes, no build-time coupling, independent deployments.

```
portal-shell (vanilla JS)
  ├── → /users  →  users-portal-angular (Full Angular)
  ├── → /users  →  users-portal-react   (Full React)
  └── → /hybrid →  users-portal-angular (host)
                       └── /hybrid route → ReactWrapperComponent
                                              └── loadRemote('react-users/mount')
                                                    └── users-portal-react (remote)
                                                          mount(container, { initialPath: '/users', platform })
```

## Packages

| Package | Role |
| :--- | :--- |
| `@module-federation/vite` | Vite plugin — builds React app as ES module remote, generates `remoteEntry.js` |
| `@module-federation/runtime` | Browser runtime — loaded in Angular, resolves and imports the remote |

## React remote — `mount()` API

The React app exposes a single framework-agnostic function via `src/mount.tsx`, typed by the shared `MountMfe` contract:

```ts
export const mount: MountMfe = (
  container: HTMLElement,
  { initialPath, platform }: MfeMountOptions
) => { /* … */ return unmount; };
```

- **Owns everything**: `ReactDOM.createRoot`, `QueryClientProvider`, `MemoryRouter`, and a `PlatformProvider` that exposes the injected SDK via `usePlatform()`
- **Returns an unmount function** — Angular calls it in `ngOnDestroy`
- **Module-scope `QueryClient` singleton** — survives Angular mount/unmount cycles without resetting cache
- **Receives `initialPath` + an injected `platform`** (a `PlatformSDK`), not domain props — React handles its own navigation and reads shared capabilities through the SDK

## Angular host — framework-agnostic wrapper

`ReactWrapperComponent` has zero React knowledge — no React imports, no ReactDOM. It injects the shell's platform singleton and passes it through the mount contract:

```ts
private readonly platform = inject(PlatformService);   // shell-owned singleton

async ngAfterViewInit() {
  const mod = await loadRemote<{ mount: MountMfe }>('react-users/mount');
  this.unmount = mod!.mount(this.container.nativeElement, {
    initialPath: '/users',
    platform: this.platform.sdk,
  });
}
```

`init()` in `main.ts` registers the remote URL at boot but makes no network request. The actual `remoteEntry.js` fetch only happens when the user navigates to `/hybrid`.

## Platform SDK — capabilities injected at the seam

The host injects more than a path — it hands the remote a **platform capability object** it depends on *by interface*. The contract lives in a shared, framework-agnostic lib, **`@portal/platform`**:

```ts
interface PlatformSDK {
  events: EventBus;   // typed cross-MFE pub/sub — extensible: auth, navigation, flags, …
}
```

- **One contract, shared by shape** — `@portal/platform` owns `PlatformSDK`, `MfeMountOptions`, `MountMfe`, and a typed `EventBus`. Host and remote depend on the *shape*, not on each other's code, so the seam stays framework-agnostic (a future Vue MFE would consume the same contract).
- **Built once at the shell root** — the Angular host's `PlatformService` (`providedIn: 'root'`) assembles the SDK a single time and injects the *same* instance into every MFE. One platform, shared — the same discipline as one WebSocket at the root, not one per route.
- **Consumed by interface** — the remote reads it through a `usePlatform()` context and never knows whether it was mounted directly (same JS realm) or, in a future sandboxed setup, behind a `postMessage` proxy. Same `PlatformSDK` either way = location transparency.
- **`EventBus`** — a typed, dependency-free pub/sub for cross-MFE *moments* (`user:selected`, `session:expired`). MFEs emit and subscribe but never import each other; it carries events, not state (state belongs in a store).

## Why `type: 'module'` matters

`@module-federation/vite` generates ES module remotes with **named exports** (`export { get, init }`). The runtime default (`type: 'global'`) loads via a classic `<script>` tag and looks for a `window['react-users']` global — which is never set. `type: 'module'` switches to `import(url)` and reads the named exports directly.

```ts
// apps/users-portal-angular/src/main.ts
init({
  name: 'angular-host',
  remotes: [{ name: 'react-users', entry: reactRemoteUrl, type: 'module' }],
});
```

## Dev mode — React Fast Refresh preamble

In dev mode, `@vitejs/plugin-react` injects a `window.__vite_plugin_react_preamble_installed__` check into every JSX file. Normally injected by Vite's HTML transform — which never runs in the Angular host. `src/federation-dev-preamble.ts` installs stub globals as a **side-effect import at the top of `mount.tsx`**, before any component module evaluates. HMR doesn't work for the remote in this mode — that's expected.
