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
  { initialPath }: { initialPath: string }
): Unmount {
  const root = createRoot(container);
  root.render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return () => root.unmount();
}