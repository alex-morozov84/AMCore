import assert from 'node:assert/strict'
import { test } from 'node:test'

import { operationsConsoleOwnership } from './operations-console-ownership.mjs'
import { buildProjectFactPlan } from './project-fact-plan.mjs'

const root = process.cwd()

function plan(flags, slug = 'admin') {
  return buildProjectFactPlan(root, flags, slug)
}

function count(facts, kind) {
  return facts.filter((fact) => fact.kind === kind).length
}

function factFor(facts, operationKey) {
  return facts.find((fact) => fact.operationKey === operationKey)
}

test('derives the complete disabled Console projection from the manifest', () => {
  const result = plan({ 'admin-console': 'disabled' })
  assert.equal(operationsConsoleOwnership.facts.roots.length, 9)
  // Each file registered in operationsConsoleFacts.verification (outside
  // every closed root) adds its own delete fact. A closed-root addition
  // does not - the root's single delete fact already covers it.
  assert.equal(count(result.consoleFacts, 'delete'), 30)
  assert.equal(count(result.consoleFacts, 'content'), 20)
  assert.equal(result.consoleSteps.length, 41)
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
    assert.equal(count(result.consoleFacts, 'content'), 4)
  }
})

test('composes single-locale en and ru with host routing', () => {
  for (const locale of ['en', 'ru']) {
    const result = plan({ mode: 'single', locale, 'admin-console': 'host' }, 'panel')
    assert.equal(count(result.consoleFacts, 'move'), 4)
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
  assert.equal(count(result.consoleFacts, 'delete'), 30)
  assert.equal(count(result.consoleFacts, 'content'), 19)
  assert.ok(
    result.sharedContentFacts
      .filter((fact) => fact.operationKey)
      .every((fact) => !fact.operationKey.includes('combined'))
  )
})
