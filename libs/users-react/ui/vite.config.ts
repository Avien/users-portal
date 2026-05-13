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
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/libs/users-react/ui',
      provider: 'v8',
    },
  },
});