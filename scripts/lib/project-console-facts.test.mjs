import assert from 'node:assert/strict'
import { test } from 'node:test'

import { operationsConsoleOwnership } from './operations-console-ownership.mjs'
import { buildProjectFactPlan } from './project-fact-plan.mjs'
import { assertExactScaffoldCounts } from './scaffold-exact-counts.mjs'

const root = process.cwd()

function plan(flags, slug = 'admin') {
  const key = JSON.stringify([flags, slug])
  plans.set(key, plans.get(key) ?? buildProjectFactPlan(root, flags, slug))
  return plans.get(key)
}

const plans = new Map()

function count(facts, kind) {
  return facts.filter((fact) => fact.kind === kind).length
}

function factFor(facts, operationKey) {
  return facts.find((fact) => fact.operationKey === operationKey)
}

test('reports every stale Console exact count together', () => {
  const disabled = plan({ 'admin-console': 'disabled' })
  const path = plan({ 'admin-console': 'path' }, 'panel')
  const host = plan({ 'admin-console': 'host' }, 'panel')
  const singleHost = plan({ mode: 'single', locale: 'ru', 'admin-console': 'host' }, 'panel')
  const singleDisabled = plan({
    mode: 'single',
    locale: 'ru',
    storybook: 'disabled',
    'route-progress': 'disabled',
    'admin-console': 'disabled',
  })
  // The lifecycle Console link adds one content fact and one disabled step. Scheduled jobs add one
  // feature root, two shared modules (one with a test), a stand fixture and an e2e spec: six deletes.
  // Integrations add a feature root, a stand fixture and an e2e spec: three more deletes.
  assertExactScaffoldCounts([
    { name: 'console roots', expected: 24, actual: operationsConsoleOwnership.facts.roots.length },
    {
      name: 'console disabled deletes',
      expected: 93,
      actual: count(disabled.consoleFacts, 'delete'),
    },
    {
      name: 'console disabled content',
      expected: 62,
      actual: count(disabled.consoleFacts, 'content'),
    },
    { name: 'console disabled steps', expected: 137, actual: disabled.consoleSteps.length },
    { name: 'console path content', expected: 4, actual: count(path.consoleFacts, 'content') },
    { name: 'console host content', expected: 4, actual: count(host.consoleFacts, 'content') },
    {
      name: 'console single-locale moves',
      expected: 3,
      actual: count(singleHost.consoleFacts, 'move'),
    },
    {
      name: 'console single-locale proxy facts',
      expected: 2,
      actual: singleHost.consoleFacts.filter(
        (fact) => fact.operationKey === 'console.proxy-single-locale'
      ).length,
    },
    {
      name: 'console single-locale deletes',
      expected: 93,
      actual: count(singleDisabled.consoleFacts, 'delete'),
    },
    {
      name: 'console single-locale content',
      expected: 61,
      actual: count(singleDisabled.consoleFacts, 'content'),
    },
  ])
})

test('derives the complete disabled Console projection from the manifest', () => {
  const result = plan({ 'admin-console': 'disabled' })
  assert.ok(
    result.consoleFacts.some(
      (fact) => fact.kind === 'delete' && fact.path === 'docs/operations-console'
    )
  )
  const removed = (file) =>
    result.consoleFacts.some(
      (fact) => fact.kind === 'delete' && (file === fact.path || file.startsWith(`${fact.path}/`))
    )
  for (const file of [
    'apps/web/src/features/console-integrations',
    'scripts/stand/integrations-fixture.mjs',
    'apps/web/e2e/real-stack/admin-integrations.spec.ts',
  ])
    assert.equal(removed(file), true, file)
  for (const file of [
    'apps/api/src/core/admin/integrations/integration-registry.ts',
    'apps/api/src/core/admin/admin-integrations.controller.ts',
    'apps/api/src/core/admin/integrations/readers/email.reader.ts',
    'docs/backend/integrations.md',
    'docs/email/README.md',
  ])
    assert.equal(removed(file), false, file)
  assert.ok(result.consoleFacts.every((fact) => !('scenario' in fact)))
})

test('expresses path and host custom slugs as ordinary values', () => {
  for (const mode of ['path', 'host']) {
    const result = plan({ 'admin-console': mode }, 'panel')
    const config = factFor(result.consoleFacts, 'console.runtime-config')
    assert.deepEqual(config.params, { mode, slug: 'panel' })
    assert.ok(
      result.consoleFacts.some(
        (fact) => fact.kind === 'move' && fact.to === 'apps/web/src/app/[locale]/panel'
      )
    )
  }
})

test('composes single-locale en and ru with host routing', () => {
  for (const locale of ['en', 'ru']) {
    const result = plan({ mode: 'single', locale, 'admin-console': 'host' }, 'panel')
    assert.equal(
      result.consoleFacts.filter((fact) => fact.operationKey === 'console.proxy-single-locale')
        .length,
      2
    )
    assert.equal(result.desiredState.locale.base, locale)
  }
})

test('composes all dimensions without a combined adapter', () => {
  const result = plan({
    mode: 'single',
    locale: 'ru',
    storybook: 'disabled',
    'route-progress': 'disabled',
    'admin-console': 'disabled',
  })
  assert.ok(
    result.sharedContentFacts
      .filter((fact) => fact.operationKey)
      .every((fact) => !fact.operationKey.includes('combined'))
  )
})
