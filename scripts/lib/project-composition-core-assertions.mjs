import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'

import { ROUTE_PROGRESS_SOURCE_PATH } from './project-route-progress-ownership.mjs'
import { SCAFFOLD_COVERING_SCENARIOS } from './scaffold-covering-recipes.mjs'
import {
  requiredCoverage,
  rowCoverage,
  validateCoveringScenarios,
} from './scaffold-coverage-contract.mjs'

function operationKeys(plan) {
  return [
    ...new Set(plan.localeFacts.flatMap((fact) => (fact.operationKey ? [fact.operationKey] : []))),
  ].sort()
}

function assertLocalePlan(plan, expectedKeys) {
  assert.deepEqual(operationKeys(plan), expectedKeys)
  assert.ok(
    plan.localeSteps.every(
      (step) =>
        step.modulePath === 'scripts/lib/project-locale-materializer.mjs' &&
        step.adapterClass !== 'whole-file-legacy-before-after'
    )
  )
  assert.ok(plan.steps.every((step) => !step.modulePath?.startsWith('scripts/lib/project-plan-')))
  assert.ok(
    plan.operations.every((operation) => !path.isAbsolute(operation.target ?? operation.to))
  )
}

function registerCoverageAssertions(matrix) {
  test('covers every declared topology, dimension pair, proxy shape, and old recipe duty', () => {
    assert.deepEqual(validateCoveringScenarios(SCAFFOLD_COVERING_SCENARIOS), [])
  })
  test('has six isolated rows with one install and one build command each', () => {
    assert.equal(SCAFFOLD_COVERING_SCENARIOS.length, 6)
    for (const row of SCAFFOLD_COVERING_SCENARIOS) {
      assert.equal(row.installBefore, undefined, row.name)
      assert.equal(row.installAfter, true, row.name)
      assert.equal(row.skipVerify, true, row.name)
    }
  })
  test('keeps all 47 project states in the cheap planning layer', () => {
    assert.equal(matrix.rows.length, 47)
    assert.ok(matrix.rows.every((row) => row.plan.steps.length > 0))
  })
}

function registerMissingWitnessAssertion() {
  test('mutation: removing every witness for any obligation is rejected', () => {
    for (const requirement of requiredCoverage()) {
      const rows = SCAFFOLD_COVERING_SCENARIOS.filter((row) => !rowCoverage(row).has(requirement))
      assert.match(
        validateCoveringScenarios(rows).join('\n'),
        new RegExp(`missing coverage:.*${escape(requirement)}`)
      )
    }
  })
}

function registerDuplicateWorkAssertion() {
  test('mutation: duplicate install or build work in one row is rejected', () => {
    const [first, ...rest] = SCAFFOLD_COVERING_SCENARIOS
    const install = { ...first, installBefore: true }
    const build = {
      ...first,
      postApplySteps: [...first.postApplySteps, ['--filter', 'web', 'build']],
    }
    assert.match(validateCoveringScenarios([install, ...rest]).join('\n'), /one install/)
    assert.match(validateCoveringScenarios([build, ...rest]).join('\n'), /one build/)
  })
}

function registerHistoricalDutyAssertion() {
  test('mutation: every historical duty keeps its commands and one retained owner', () => {
    const duty = 'storybook-disabled-manual-verify-after'
    const weakened = SCAFFOLD_COVERING_SCENARIOS.map((row) =>
      row.replaces.includes(duty)
        ? { ...row, postApplySteps: [['exec', 'turbo', 'run', 'build', '--filter=@amcore/web']] }
        : row
    )
    const duplicated = SCAFFOLD_COVERING_SCENARIOS.map((row, index) =>
      index === 2 ? { ...row, replaces: [...row.replaces, duty] } : row
    )
    assert.match(validateCoveringScenarios(weakened).join('\n'), /missing obligations/)
    assert.match(validateCoveringScenarios(duplicated).join('\n'), /exactly one retained row/)
  })
}

function registerCoverageMutationAssertions() {
  registerMissingWitnessAssertion()
  registerDuplicateWorkAssertion()
  registerHistoricalDutyAssertion()
}

function escape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function registerLocaleAssertions(matrix) {
  test('portable current-tree contract covers all 32 locale compositions', () => {
    const rows = matrix.rows.filter((row) => row.state.locale)
    const expectedKeys = operationKeys(rows[0].plan)
    for (const { plan } of rows) assertLocalePlan(plan, expectedKeys)
    assert.equal(rows.length, 32)
  })
}

function registerRouteProgressAssertions(matrix) {
  test('--route-progress=disabled produces one declarative false-valued source fact', () => {
    const state = {
      locale: undefined,
      storybook: false,
      routeProgress: true,
      console: undefined,
      slug: 'panel',
    }
    const plan = matrix.get(state).plan
    const facts = plan.sharedContentFacts.filter((fact) => fact.path === ROUTE_PROGRESS_SOURCE_PATH)
    assert.equal(facts.length, 1)
    assert.equal(facts[0].params.enabled, false)
    assert.equal(plan.desiredState.routeProgress, 'disabled')
  })
  test('all 24 route-progress combinations use the same independent adapter', () => {
    const rows = matrix.rows.filter((row) => row.state.routeProgress)
    const key = rows[0].plan.sharedContentFacts.find(
      (fact) => fact.path === ROUTE_PROGRESS_SOURCE_PATH
    ).operationKey
    for (const { plan } of rows) {
      const fact = plan.sharedContentFacts.find((item) => item.path === ROUTE_PROGRESS_SOURCE_PATH)
      assert.equal(fact.operationKey, key)
      assert.equal(Object.hasOwn(fact, 'scenario'), false)
      assert.ok(plan.sharedContentFacts.every((item) => !item.operationKey?.includes('combined')))
    }
    assert.equal(rows.length, 24)
  })
}

export function registerCoreCompositionAssertions(matrix) {
  registerCoverageAssertions(matrix)
  registerCoverageMutationAssertions()
  registerLocaleAssertions(matrix)
  registerRouteProgressAssertions(matrix)
}
