import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/ · https://vitest.dev/config/
export default defineConfig({
  plugins: [
    vue(),
  ],
  // vue-i18n@10's esm-bundler build (client/node_modules/vue-i18n/README.md,
  // "For Bundler feature flags") reads these as global feature flags at
  // build time; Vite/esbuild self-initializes safe defaults if they're
  // left undefined, but explicit values here let esbuild dead-code-eliminate
  // the unused branches instead of shipping them. Verified directly against
  // the installed v10.0.8 package (not copied from docs):
  //   - __VUE_I18N_FULL_INSTALL__: true — keep full API (directives/components)
  //     available for later tasks.
  //   - __VUE_I18N_LEGACY_API__: false — this app only ever calls
  //     createI18n({ legacy: false, ... }) (client/src/i18n.ts), so the
  //     legacy Options-API code path is dead weight; disabling it here lets
  //     the bundler drop it.
  //   - __INTLIFY_DROP_MESSAGE_COMPILER__: false — MUST stay false. Locale
  //     strings are loaded as plain JSON (client/src/locales/**/*.json), not
  //     pre-compiled by a build-time plugin, so the runtime message compiler
  //     is required to evaluate any interpolation/plural syntax in those
  //     strings; dropping it would silently break such messages.
  //   - __INTLIFY_PROD_DEVTOOLS__: false — matches the library default,
  //     keeps the devtools hook out of production bundles.
  // NOTE: the plan this was implemented from also listed
  // `__VUE_I18N_PROD_DEVTOOLS__`. That flag does not exist anywhere in the
  // installed vue-i18n@10.0.8 source (confirmed via grep across
  // node_modules/vue-i18n/dist and node_modules/@intlify/*/dist) — it was a
  // stale carryover from older vue-i18n v9-era examples, so it's omitted
  // here rather than defining an unused global.
  define: {
    __VUE_I18N_FULL_INSTALL__: true,
    __VUE_I18N_LEGACY_API__: false,
    __INTLIFY_DROP_MESSAGE_COMPILER__: false,
    __INTLIFY_PROD_DEVTOOLS__: false,
  },
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
