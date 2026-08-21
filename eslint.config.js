'use strict';

// Flat config (ESLint 9+ format — this repo pins ESLint ^10, which uses the
// same flat-config shape). Lints server/src (TypeScript, CommonJS/Node) and
// client/src (Vue 3 + TypeScript). See docs/superpowers/plans/
// 2026-08-18-professional-hardening.md Stage 0 for why this exists.

const tseslint = require('typescript-eslint');
const pluginVue = require('eslint-plugin-vue');
const vueParser = require('vue-eslint-parser');

module.exports = tseslint.config(
  {
    // Global ignores (must be its own config object with only "ignores" to
    // apply repo-wide rather than scoped to a "files" pattern).
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
    ],
  },

  // ── server/src: plain TypeScript, CommonJS, Node ──────────────────────────
  {
    files: ['server/src/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      sourceType: 'commonjs',
    },
    rules: {
      // The codebase intentionally uses `any` in a handful of narrow spots
      // (e.g. parsing untyped config/JSON from disk). Keep it a warning
      // rather than banning it outright until those call sites are audited.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Several route/service files destructure `req`/`res`/`next` params
      // that aren't all used in every handler; not worth a hard failure.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ── shared/: plain TypeScript, type-only, consumed by both server and
  // client (Task 23) -- see server/tsconfig.json / client/tsconfig.app.json
  // for the `@shared/*` path alias each side resolves this through.
  {
    files: ['shared/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ── client/src: Vue 3 SFCs + TypeScript ────────────────────────────────────
  {
    files: ['client/src/**/*.{ts,vue}'],
    // `flat/recommended` was tried first but its extra rules over
    // `flat/essential` are almost entirely HTML-formatting concerns
    // (html-indent, attributes-order, max-attributes-per-line,
    // closing-bracket-newline, ...) that duplicate what Prettier already
    // owns and produced ~3000 warnings purely from the existing templates'
    // whitespace not matching that formatting opinion — noise, not signal.
    // `flat/essential` keeps the bug/reactivity-prevention rules (bad
    // v-for keys, duplicate keys, side effects in computed, etc.) and we
    // add back the handful of non-formatting `recommended` rules that are
    // still meaningful (explicit emits, no v-html, casing, no-shadowing).
    extends: [...tseslint.configs.recommended, ...pluginVue.configs['flat/essential']],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The existing component set doesn't follow single-word or
      // fully-PascalCase naming (e.g. App.vue, index views); not worth a
      // repo-wide rename for a lint tooling task.
      'vue/multi-word-component-names': 'off',
      // Non-formatting rules pulled forward from flat/recommended (see note
      // above) — real code-quality/security value, no whitespace opinions.
      'vue/require-explicit-emits': 'warn',
      'vue/no-v-html': 'warn',
      'vue/prop-name-casing': 'warn',
      'vue/component-definition-name-casing': 'warn',
      'vue/no-template-shadow': 'warn',
      'vue/attribute-hyphenation': 'warn',
      'vue/v-on-event-hyphenation': 'warn',
      'vue/require-default-prop': 'warn',
      'vue/order-in-components': 'warn',
      'vue/no-lone-template': 'warn',
      'vue/no-multiple-slot-args': 'warn',
      'vue/this-in-template': 'warn',
      'vue/one-component-per-file': 'warn',
    },
  },
);
