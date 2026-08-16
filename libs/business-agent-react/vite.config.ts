/// <reference types='vitest' />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/business-agent-react',
  plugins: [react(), nxViteTsPaths()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/libs/business-agent-react',
      provider: 'v8',
    },
  },
});
