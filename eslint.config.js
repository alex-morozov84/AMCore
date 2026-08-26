import baseConfig from '@amcore/eslint-config/base'

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...baseConfig,
  {
    ignores: ['apps/**', 'packages/**'],
  },
  {
    // `base.js`'s TypeScript-oriented block only targets .ts/.tsx/.js/.jsx —
    // root-level standalone tooling (scripts/**) is plain Node ESM and needs
    // its runtime globals declared directly instead.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly' },
    },
  },
]
