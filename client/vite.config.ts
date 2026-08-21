import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/ · https://vitest.dev/config/
export default defineConfig({
  plugins: [
    vue(),
  ],
  resolve: {
    alias: {
      // Task 23: shared request/response types used by both client and
      // server (see server/tsconfig.json for the server-side counterpart).
      // Only ever consumed via `import type`, which esbuild/TS erase
      // entirely before bundling -- this alias exists so the small number
      // of runtime-adjacent tools that also resolve modules (Vitest, IDE
      // tooling) agree with tsconfig.app.json's "paths" entry, not because
      // the client ships any actual runtime code from `shared/`.
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
  },
})
