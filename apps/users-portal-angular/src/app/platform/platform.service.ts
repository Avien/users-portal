import { Injectable } from '@angular/core';
import { createEventBus, type PlatformSDK } from '@portal/platform';

/**
 * The app shell, built ONCE at bootstrap (root-provided). It assembles the PlatformSDK and
 * exposes the SAME instance to inject into every MFE — one platform, shared. A route-bound
 * component must never build its own (one shared instance, like a WebSocket at the shell root).
 */
@Injectable({ providedIn: 'root' })
export class PlatformService {
  readonly sdk: PlatformSDK = {
    events: createEventBus(),
  };
}