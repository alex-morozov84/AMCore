import { residualConfig } from '@amcore/eslint-config/hybrid'
import { policy as baseConfig } from '@amcore/eslint-config/base'

/** @type {import('eslint').Linter.Config[]} */
export const policy = [
  ...baseConfig,
  {
    ignores: ['dist/**'],
  },
]

export default residualConfig(policy)
