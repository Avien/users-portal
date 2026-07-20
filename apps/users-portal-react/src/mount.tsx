import './federation-dev-preamble';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlatformProvider } from './platform-context';
import type { MountMfe } from '@portal/platform';
import App from './app/app';

// Module-scope singletons — survive Angular/shell mount/unmount cycles.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

// The host passes an options object: `initialPath` down + the injected `platform`
// capabilities (and optional events-up callbacks). PlatformProvider exposes the SDK
// to the whole tree via `usePlatform()`.
export const mount: MountMfe = (container, { initialPath, platform }) => {
  const root = createRoot(container);
  root.render(
    <PlatformProvider platform={platform}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    </PlatformProvider>
  );
  return () => root.unmount();
};