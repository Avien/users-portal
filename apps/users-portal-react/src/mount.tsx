import './federation-dev-preamble';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './app/app';

// Module-scope singletons — survive Angular mount/unmount cycles
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

type Unmount = () => void;

export function mount(
  container: HTMLElement,
  { initialPath, enableWs = true }: { initialPath: string; enableWs?: boolean }
): Unmount {
  const root = createRoot(container);
  root.render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <App enableWs={enableWs} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return () => root.unmount();
}