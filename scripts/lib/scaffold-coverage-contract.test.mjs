import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCAFFOLD_COVERING_SCENARIOS } from './scaffold-covering-recipes.mjs'
import {
  requiredCoverage,
  rowCoverage,
  validateCoveringScenarios,
} from './scaffold-coverage-contract.mjs'
import { prepareProjectInit } from './project-init-plan.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function allProjectStates() {
  const states = []
  for (const locale of [undefined, 'en', 'ru']) {
    for (const storybook of [false, true]) {
      for (const routeProgress of [false, true]) {
        for (const console of [undefined, 'disabled', 'path', 'host']) {
          if (locale || storybook || routeProgress || console)
            states.push({ locale, storybook, routeProgress, console })
        }
      }
    }
  }
  return states
}

function flagsFor(state) {
  return {
    ...(state.locale ? { mode: 'single', locale: state.locale } : {}),
    ...(state.storybook ? { storybook: 'disabled' } : {}),
    ...(state.routeProgress ? { 'route-progress': 'disabled' } : {}),
    ...(state.console ? { 'admin-console': state.console } : {}),
  }
}

describe('scaffolding L3 covering array', () => {
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
    const states = allProjectStates()
    assert.equal(states.length, 47)
    for (const state of states) {
      const plan = prepareProjectInit(REPO_ROOT, flagsFor(state), 'panel')
      assert.ok(plan.steps.length > 0, JSON.stringify(state))
    }
  })

  test('mutation: removing every witness for any obligation is rejected', () => {
    for (const requirement of requiredCoverage()) {
      const mutated = SCAFFOLD_COVERING_SCENARIOS.filter(
        (row) => !rowCoverage(row).has(requirement)
      )
      assert.match(
        validateCoveringScenarios(mutated).join('\n'),
        new RegExp(`missing coverage:.*${requirement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
        requirement
      )
    }
  })

  test('mutation: duplicate install or build work in one row is rejected', () => {
    const [first, ...rest] = SCAFFOLD_COVERING_SCENARIOS
    const duplicateInstall = { ...first, installBefore: true }
    const duplicateBuild = {
      ...first,
      postApplySteps: [...first.postApplySteps, ['--filter', 'web', 'build']],
    }
    assert.match(validateCoveringScenarios([duplicateInstall, ...rest]).join('\n'), /one install/)
    assert.match(validateCoveringScenarios([duplicateBuild, ...rest]).join('\n'), /one build/)
  })

  test('mutation: every historical duty keeps its commands and one retained owner', () => {
    const storyDuty = 'storybook-disabled-manual-verify-after'
    const weakened = SCAFFOLD_COVERING_SCENARIOS.map((row) =>
      row.replaces.includes(storyDuty)
        ? { ...row, postApplySteps: [['exec', 'turbo', 'run', 'build', '--filter=@amcore/web']] }
        : row
    )
    const duplicated = SCAFFOLD_COVERING_SCENARIOS.map((row, index) =>
      index === 2 ? { ...row, replaces: [...row.replaces, storyDuty] } : row
    )
    assert.match(validateCoveringScenarios(weakened).join('\n'), /missing obligations/)
    assert.match(validateCoveringScenarios(duplicated).join('\n'), /exactly one retained row/)
  })
})
