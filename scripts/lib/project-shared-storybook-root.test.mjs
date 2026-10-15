import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { removeStorybookRoot } from './project-shared-storybook-root.mjs'

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')

test('Storybook removal preserves the current API ESM and native-build instructions', () => {
  const result = removeStorybookRoot(readme)
  assert.ok(result.includes('API build requires type checking before SWC emission'))
  assert.ok(result.includes('[API build and ESM runtime](docs/backend/api-build.md)'))
  assert.ok(result.includes('Vitest runs `packages/shared`'))
  assert.ok(result.includes('Playwright runs frontend'))
  assert.ok(!result.includes('Storybook covers'))
  assert.ok(!result.split('\n').some((line) => line.startsWith('| Storybook ')))
})

test('Storybook removal still refuses an unexpected tooling block', () => {
  const changed = readme.replace('API build requires type checking', 'Unexpected API build wording')
  assert.throws(() => removeStorybookRoot(changed), /expected exactly one occurrence/)
})
