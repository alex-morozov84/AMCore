import { policy as baseConfig } from '@amcore/eslint-config/base'
import { residualConfig } from '@amcore/eslint-config/hybrid'

/** @type {import('eslint').Linter.Config[]} */
export const policy = [
  ...baseConfig,
  {
    // These maintained root/image configs participate in the paired command too.
    ignores: ['apps/**', 'packages/**', '!eslint.config.js', '!docker/migrator/prisma.config.mjs'],
  },
  {
    // `base.js`'s TypeScript-oriented block only targets .ts/.tsx/.js/.jsx —
    // root-level standalone tooling (scripts/**) is plain Node ESM and needs
    // its runtime globals declared directly instead.
    files: ['scripts/**/*.mjs', 'docker/migrator/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        performance: 'readonly',
      },
    },
  },
]

export default residualConfig(policy)
