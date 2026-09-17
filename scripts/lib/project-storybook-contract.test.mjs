import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, test } from 'node:test'

import { prepareProjectInit } from './project-init-plan.mjs'

const ROOT = path.resolve('.')
const STORYBOOK_KEYS = [
  'architecture-storybook',
  'context-storybook',
  'docs-index-storybook',
  'frontend-index-storybook',
  'package-storybook',
  'project-eslint-remove-storybook',
  'readme-storybook',
  'storybook.docs-agents',
  'storybook.docs-brand',
  'storybook.docs-ci-security',
  'storybook.docs-console-development',
  'storybook.docs-contributing',
  'storybook.docs-route-progress',
  'storybook.docs-shared-ui',
  'storybook.docs-testing',
  'storybook.gitignore',
  'storybook.vitest-project',
  'storybook.workflow-ci',
  'storybook.workflow-dependency-review',
]

function flags(locale, routeProgress, consoleMode) {
  return {
    storybook: 'disabled',
    ...(locale ? { mode: 'single', locale } : {}),
    ...(routeProgress ? { 'route-progress': 'disabled' } : {}),
    ...(consoleMode ? { 'admin-console': consoleMode } : {}),
  }
}

function isNested(candidate, parent) {
  return candidate === parent || candidate.startsWith(`${parent}/`)
}

function assertConflictFree(operations) {
  const writers = operations.filter((operation) => operation.kind !== 'delete')
  assert.equal(
    new Set(writers.map((operation) => operation.target ?? operation.to)).size,
    writers.length
  )
  for (const [index, operation] of operations.entries()) {
    if (operation.kind !== 'delete') continue
    for (const earlier of operations.slice(0, index)) {
      if (earlier.kind !== 'delete')
        assert.equal(isNested(earlier.target ?? earlier.to, operation.target), false)
    }
    for (const later of operations.slice(index + 1)) {
      assert.equal(isNested(later.target ?? later.to, operation.target), false)
      if (later.from) assert.equal(isNested(later.from, operation.target), false)
    }
  }
}

function assertStorybookContract(plan) {
  const content = plan.storybookFacts.filter((fact) => fact.kind === 'content')
  const deletes = plan.storybookFacts.filter((fact) => fact.kind === 'delete')
  assert.deepEqual(content.map((fact) => fact.operationKey).sort(), STORYBOOK_KEYS)
  assert.ok(deletes.some((fact) => fact.path === 'apps/web/.storybook'))
  assert.ok(deletes.some((fact) => fact.path === 'docs/frontend/storybook.md'))
  assert.ok(deletes.some((fact) => fact.path.endsWith('.stories.tsx')))
  assert.equal(
    plan.steps.some((step) => /project-plan/.test(step.modulePath ?? '')),
    false
  )
  assert.equal(
    content.some((fact) => /combined/.test(fact.operationKey)),
    false
  )
  assertConflictFree(plan.operationPlan.operationsForApply())
}

function deterministicCapture(plan) {
  return {
    facts: plan.storybookFacts,
    steps: plan.steps,
    operations: plan.operationPlan.operationsForApply(),
    message: plan.confirmMessage,
  }
}

describe('Storybook current-tree composition contract', () => {
  for (const locale of [undefined, 'en', 'ru']) {
    for (const routeProgress of [false, true]) {
      for (const consoleMode of [undefined, 'disabled', 'path', 'host']) {
        const name = `${locale ?? 'multi'}-${routeProgress ? 'off' : 'on'}-${consoleMode ?? 'default'}`
        test(`${name}: validates ownership and one stable operation set`, () => {
          assertStorybookContract(
            prepareProjectInit(ROOT, flags(locale, routeProgress, consoleMode), 'panel')
          )
        })
      }
    }
  }

  test('the richest projection is independent of flag insertion order', () => {
    const direct = {
      mode: 'single',
      locale: 'ru',
      storybook: 'disabled',
      'route-progress': 'disabled',
      'admin-console': 'disabled',
    }
    const reverse = {
      'admin-console': 'disabled',
      'route-progress': 'disabled',
      storybook: 'disabled',
      locale: 'ru',
      mode: 'single',
    }
    assert.deepEqual(
      deterministicCapture(prepareProjectInit(ROOT, direct, 'panel')),
      deterministicCapture(prepareProjectInit(ROOT, reverse, 'panel'))
    )
  })
})
