import assert from 'node:assert/strict'
import { test } from 'node:test'

import { operationsConsoleOwnership } from './operations-console-ownership.mjs'
import { validateOwnership } from './ownership-validate.mjs'
import { buildProjectFactPlan } from './project-fact-plan.mjs'
import { assertNamedPaths } from './scaffold-named-paths.mjs'
import { storybookOwnership } from './storybook-ownership.mjs'

const enModules = [
  'apps/web/messages/en.json',
  'apps/web/src/i18n/request.ts',
  'apps/web/src/proxy.ts',
  'packages/shared/src/lib/frontend-url.ts',
]
const ruModules = [
  'apps/web/messages/ru.json',
  'apps/web/src/i18n/request.ts',
  'apps/web/src/proxy.ts',
  'packages/shared/src/lib/frontend-url.ts',
]

test('Console and Storybook have no universal shared modules', () => {
  for (const manifest of [operationsConsoleOwnership, storybookOwnership]) {
    const { projection } = validateOwnership(process.cwd(), manifest)
    assertNamedPaths(manifest.feature, [], projection.universalSharedModules)
  }
})

test('single-locale projections retain only the named universal modules', () => {
  for (const locale of ['en', 'ru']) {
    const plan = buildProjectFactPlan(process.cwd(), { mode: 'single', locale }, 'admin')
    const expected = locale === 'en' ? enModules : ruModules
    assertNamedPaths(
      `single-${locale}`,
      expected,
      plan.localeValidation.projection.universalSharedModules
    )
  }
})

test('same-count substitution reports both missing and unexpected paths', () => {
  assert.throws(
    () => assertNamedPaths('fixture', ['a.ts', 'b.ts'], new Set(['a.ts', 'c.ts'])),
    (error) => {
      assert.match(error.message, /missing \[b\.ts\]/)
      assert.match(error.message, /unexpected \[c\.ts\]/)
      return true
    }
  )
})
