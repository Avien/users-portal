/// <reference types='vitest' />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/libs/users-react/ui',
  plugins: [react(), nxViteTsPaths()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    // ErrorBoundary (this lib's only spec) moved app-local — see
    // apps/users-portal-react/src/app/error-boundary — since it's generic
    // app-shell infrastructure, not Users/Orders UI. The remaining presentational
    // components here don't have unit tests yet; matches the Jest
    // targetDefault's passWithNoTests already set repo-wide for Angular/Jest libs.
    passWithNoTests: true,
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/libs/users-react/ui',
      provider: 'v8',
    },
  },
});