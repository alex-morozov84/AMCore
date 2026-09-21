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
  const singleDisabled = plan(
    { mode: 'single', locale: 'ru', storybook: 'disabled', 'route-progress': 'disabled', 'admin-console': 'disabled' }
  )
  assertExactScaffoldCounts([
    { name: 'console roots', expected: 9, actual: operationsConsoleOwnership.facts.roots.length },
    { name: 'console disabled deletes', expected: 30, actual: count(disabled.consoleFacts, 'delete') },
    { name: 'console disabled content', expected: 20, actual: count(disabled.consoleFacts, 'content') },
    { name: 'console disabled steps', expected: 41, actual: disabled.consoleSteps.length },
    { name: 'console path content', expected: 4, actual: count(path.consoleFacts, 'content') },
    { name: 'console host content', expected: 4, actual: count(host.consoleFacts, 'content') },
    { name: 'console single-locale moves', expected: 4, actual: count(singleHost.consoleFacts, 'move') },
    { name: 'console single-locale proxy facts', expected: 2, actual: singleHost.consoleFacts.filter((fact) => fact.operationKey === 'console.proxy-single-locale').length },
    { name: 'console single-locale deletes', expected: 30, actual: count(singleDisabled.consoleFacts, 'delete') },
    { name: 'console single-locale content', expected: 19, actual: count(singleDisabled.consoleFacts, 'content') },
  ])
})

test('derives the complete disabled Console projection from the manifest', () => {
  const result = plan({ 'admin-console': 'disabled' })
  assert.ok(
    result.consoleFacts.some(
      (fact) => fact.kind === 'delete' && fact.path === 'docs/operations-console'
    )
  )
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
