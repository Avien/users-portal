/**
 * Platform contract (`@portal/platform`) — a shared, framework-agnostic package that BOTH
 * the host shell (Angular) and every MFE (React remote, future Vue MFEs) depend on. It is
 * the single source of truth for the host↔MFE seam; at runtime it would be a Module
 * Federation singleton so there is one contract instance across bundles.
 *
 * Direct MFE (one document)  → host passes its REAL platform instance to `mount()`.
 * Iframe MFE (sandboxed)     → the iframe builds a proxy platform that relays to the shell
 *                              over postMessage.
 * Same `PlatformSDK` interface either way → the MFE never knows whether it's direct or remote.
 */

export type Unmount = () => void;

/**
 * Cross-MFE moments. The payload map IS the contract — one entry per event, fully typed.
 * Carries EVENTS (things that happened), never state (that's a store) or commands (service calls).
 */
export interface PlatformEvents {
  /** A user was selected in one MFE; other MFEs may react. */
  'user:selected': { userId: number };
  /** The user's session ended; MFEs should clear sensitive state. */
  'session:expired': { reason: string };
}

/** Mediated pub/sub for cross-MFE communication — MFEs emit/subscribe, never import each other. */
export interface EventBus {
  emit<K extends keyof PlatformEvents>(event: K, payload: PlatformEvents[K]): void;
  on<K extends keyof PlatformEvents>(
    event: K,
    handler: (payload: PlatformEvents[K]) => void
  ): () => void;
}

/** Shared, cross-cutting capabilities owned by the shell and injected into every MFE. */
export interface PlatformSDK {
  events: EventBus; // cross-MFE moments (user:selected, session:expired…)
/*
  auth:         AuthService;       // user · session · token · permissions
  navigation:   NavigationService;
  analytics:    AnalyticsService;
  features:     FeatureFlags;      // config + rollout;
  */
  // + auth, navigation, marketData — same "domain service over primitives" pattern.
}

/** Options the host passes to `mount()`. */
export interface MfeMountOptions {
  /** Route the MFE boots into (the host owns the top-level URL). */
  initialPath: string;
  /** Capabilities injected by the shell — see `PlatformSDK`. */
  platform: PlatformSDK;
  /** Event up: the MFE tells the host it navigated, so the host can sync the URL bar. */
  onNavigate?: (path: string) => void;
  /** Event up: the MFE surfaces an error to the host. */
  onError?: (error: Error) => void;
}

/** The function the host calls to mount an MFE; returns its unmount. */
export type MountMfe = (
  container: HTMLElement,
  options: MfeMountOptions
) => Unmount;