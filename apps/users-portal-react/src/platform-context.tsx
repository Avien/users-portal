import { createContext, useContext, type ReactNode } from 'react';
import type { PlatformSDK } from '@portal/platform';

/**
 * Makes the injected {@link PlatformSDK} available to the whole MFE tree.
 * Any component or facade reaches native/auth/etc. via `usePlatform()` — the React
 * equivalent of Angular DI providing a platform service at the root.
 *
 *   const platform = usePlatform();
 *   platform.nativeBridge.openDeposit('users');
 */
const PlatformContext = createContext<PlatformSDK | null>(null);

export function PlatformProvider({
  platform,
  children,
}: {
  platform: PlatformSDK;
  children: ReactNode;
}) {
  return (
    <PlatformContext.Provider value={platform}>
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform(): PlatformSDK {
  const platform = useContext(PlatformContext);
  if (!platform) {
    throw new Error('usePlatform must be used within a PlatformProvider');
  }
  return platform;
}