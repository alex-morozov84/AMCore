import { nativeSettings } from './native-settings.js'
import nativeRules from './native-rules.json' with { type: 'json' }

// These checks retain their ESLint implementation and diagnostic context.
const RESIDUAL = new Set([
  'no-undef',
  'no-unsafe-optional-chaining',
  'react/no-deprecated',
  'jest/no-conditional-expect',
  'jest/valid-expect',
])
const JSX_REFERENCES = new Set(['react/jsx-uses-react', 'react/jsx-uses-vars'])

export function nativeRule(id) {
  if (RESIDUAL.has(id) || id.startsWith('react-hooks/')) return undefined
  return nativeRules[id]
}

/** The policy remains shared; only residual rules execute in ESLint. */
export function residualConfig(policy) {
  return policy.map((block) => ({
    ...block,
    ...(block.rules && {
      rules: Object.fromEntries(
        Object.entries(block.rules).filter(([id]) => !nativeRule(id) && !JSX_REFERENCES.has(id))
      ),
    }),
  }))
}

function nativeOverride(block) {
  const rules = Object.fromEntries(
    Object.entries(block.rules ?? {})
      .filter(([id]) => nativeRule(id))
      .map(([id, value]) => [nativeRule(id), value])
  )
  if (!Object.keys(rules).length) return undefined
  return {
    files: block.files ?? ['**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}'],
    ...(block.ignores && { excludeFiles: block.ignores }),
    rules,
    ...(block.languageOptions?.globals && { globals: block.languageOptions.globals }),
  }
}

/** Native builtins only: no experimental JavaScript plugin interface. */
export function nativeConfig(policy, cwd = process.cwd()) {
  return {
    plugins: ['typescript', 'react', 'jsx-a11y', 'nextjs', 'jest'],
    categories: Object.fromEntries(
      ['correctness', 'suspicious', 'pedantic', 'perf', 'style', 'restriction', 'nursery'].map(
        (category) => [category, 'off']
      )
    ),
    rules: {},
    settings: nativeSettings(policy, cwd),
    ignorePatterns: policy
      .filter((block) => block.ignores && !block.files)
      .flatMap((block) => block.ignores),
    overrides: policy.map(nativeOverride).filter(Boolean),
  }
}
