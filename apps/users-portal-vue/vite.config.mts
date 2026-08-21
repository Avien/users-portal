/// <reference types='vitest' />
import path from 'path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../node_modules/.vite/users-portal-vue',
  server: {
    port: 4202,
    host: 'localhost',
  },
  preview: {
    port: 4202,
    host: 'localhost',
  },
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
    nxCopyAssetsPlugin(['*.md']),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/users-portal-vue',
      provider: 'v8',
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, '../../dist/users-portal-vue'),
    emptyOutDir: true,
    reportCompressedSize: true,
  },
}));