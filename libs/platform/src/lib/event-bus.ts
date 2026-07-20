import type { EventBus, PlatformEvents } from './platform';

type Handler = (payload: unknown) => void;

/**
 * Minimal in-memory pub/sub for cross-MFE moments — the framework-agnostic, dependency-free
 * cousin of an RxJS Subject bus. A Map<event, Set<handler>> with per-handler error isolation
 * and a clean unsubscribe. Carries EVENTS only; a late subscriber sees only future events, so
 * shared STATE belongs in a store, not here.
 */
class InMemoryEventBus implements EventBus {
  private readonly listeners = new Map<keyof PlatformEvents, Set<Handler>>();

  emit<K extends keyof PlatformEvents>(event: K, payload: PlatformEvents[K]): void {
    this.listeners.get(event)?.forEach((handler) => {
      try {
        handler(payload);
      } catch {
        /* isolate one throwing handler from the rest */
      }
    });
  }

  on<K extends keyof PlatformEvents>(
    event: K,
    handler: (payload: PlatformEvents[K]) => void
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(handler as Handler);
    return () => this.listeners.get(event)?.delete(handler as Handler);
  }
}

/** The shell builds one bus at bootstrap and injects it into every MFE. */
export function createEventBus(): EventBus {
  return new InMemoryEventBus();
}