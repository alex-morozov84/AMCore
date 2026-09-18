import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildProjectStorybookFacts } from './project-storybook-facts.mjs'
import { prepareProjectInit } from './project-init-plan.mjs'
import { projectPlan } from './project-composition-matrix-fixture.mjs'

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
  assertConflictFree(plan.operations)
}

function storybookName(state) {
  const locale = state.locale ?? 'multi'
  const route = state.routeProgress ? 'off' : 'on'
  return `${locale}-${route}-${state.console ?? 'default'}`
}

function registerCompositionContracts(matrix, root) {
  for (const row of matrix.rows.filter((item) => item.state.storybook)) {
    test(`${storybookName(row.state)}: validates ownership and one stable operation set`, () => {
      assertStorybookContract(row.plan)
    })
  }
  test('the richest projection is independent of flag insertion order', () => {
    const state = {
      locale: 'ru',
      storybook: true,
      routeProgress: true,
      console: 'disabled',
      slug: 'panel',
    }
    const reverse = {
      'admin-console': 'disabled',
      'route-progress': 'disabled',
      storybook: 'disabled',
      locale: 'ru',
      mode: 'single',
    }
    const expected = matrix.get(state).plan
    assert.deepEqual(projectPlan(prepareProjectInit(root, reverse, 'panel')), expected)
  })
}

function registerFactPresenceAssertion(matrix, root) {
  test('exist only when Storybook is selected and contain no scenario names', () => {
    const off = matrix.get({
      locale: undefined,
      storybook: false,
      routeProgress: true,
      console: undefined,
      slug: 'panel',
    })
    assert.deepEqual(buildProjectStorybookFacts(root, off.plan.desiredState).facts, [])
    const facts = matrix.get({
      locale: undefined,
      storybook: true,
      routeProgress: false,
      console: undefined,
      slug: 'panel',
    }).plan.storybookFacts
    assert.ok(facts.length > 0)
    assert.equal(JSON.stringify(facts).includes('coverage-'), false)
    assert.equal(JSON.stringify(facts).includes('storybook-disabled-install-before'), false)
  })
}

function registerStableKeysAssertion(matrix) {
  test('all 24 compositions use one stable set of Storybook operation keys', () => {
    const rows = matrix.rows.filter((row) => row.state.storybook)
    const keysFor = (row) =>
      row.plan.storybookFacts
        .filter((fact) => fact.kind === 'content')
        .map((fact) => fact.operationKey)
        .sort()
    const expected = keysFor(rows[0])
    for (const row of rows) assert.deepEqual(keysFor(row), expected)
    assert.equal(rows.length, 24)
  })
}

function registerFactContracts(matrix, root) {
  registerFactPresenceAssertion(matrix, root)
  registerStableKeysAssertion(matrix)
}

export function registerStorybookCompositionAssertions(matrix, root) {
  registerCompositionContracts(matrix, root)
  registerFactContracts(matrix, root)
}
