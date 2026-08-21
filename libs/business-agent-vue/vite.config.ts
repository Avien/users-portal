/// <reference types='vitest' />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/business-agent-vue',
  plugins: [
    vue({
      template: {
        compilerOptions: {
          // <business-agent-widget> is a real (registered) Custom Element, not an
          // unresolved Vue component — this stops Vue from warning/erroring on it.
          isCustomElement: (tag) => tag === 'business-agent-widget',
        },
      },
    }),
    nxViteTsPaths(),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/libs/business-agent-vue',
      provider: 'v8',
    },
  },
});
