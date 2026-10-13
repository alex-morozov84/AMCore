import { policy as base } from './base.js'
import { residualConfig } from './hybrid.js'

export const policy = [
  ...base,
  { files: ['**/*.js', '**/*.mjs'], languageOptions: { globals: { process: 'readonly' } } },
]
export default residualConfig(policy)
