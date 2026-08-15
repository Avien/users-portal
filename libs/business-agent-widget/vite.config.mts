/// <reference types='vitest' />
import path from 'path';
import { defineConfig } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

// Lib-mode build — output is a single dependency-free ES module, loadable via a
// plain <script type="module" src="..."> in any app, including the no-build portal-shell.
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/business-agent-widget',
  plugins: [nxViteTsPaths()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/libs/business-agent-widget',
      provider: 'v8',
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, '../../dist/business-agent-widget'),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(import.meta.dirname, 'src/index.ts'),
      name: 'BusinessAgentWidget',
      fileName: 'business-agent-widget',
      formats: ['es'],
    },
  },
});
