import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { SCENARIOS } from './scenario-registry.mjs'
import {
  SCAFFOLD_EXHAUSTIVE_SCENARIOS,
  STORYBOOK_DISABLED_MANUAL_SCENARIO,
  STORYBOOK_MANUAL_VERIFY_STEPS,
} from '../lib/scaffold-scenario-recipes.mjs'
import { SCAFFOLD_COVERING_SCENARIOS } from '../lib/scaffold-covering-recipes.mjs'

describe('scenario-registry', () => {
  test('re-exports the required covering scenarios measured after PR4', () => {
    assert.equal(SCENARIOS, SCAFFOLD_COVERING_SCENARIOS)
  })

  test('contains the independently expected six covering scenarios', () => {
    assert.deepEqual(
      SCENARIOS.map((scenario) => scenario.name),
      [
        'coverage-multi-path',
        'coverage-multi-host-route-off',
        'coverage-multi-disabled-storybook-off',
        'coverage-single-en-path-storybook-route-off',
        'coverage-single-ru-host-storybook-off',
        'coverage-single-en-disabled-route-off',
      ]
    )
  })

  test('every scenario name is unique and every flag is a string', () => {
    const names = SCENARIOS.map((scenario) => scenario.name)
    assert.deepEqual(names, [...new Set(names)])
    for (const scenario of SCENARIOS)
      assert.ok(scenario.flags.every((flag) => typeof flag === 'string'))
  })

  test('covering scenarios declare an explicit verification recipe', () => {
    for (const scenario of SCENARIOS) {
      if (scenario.skipVerify) assert.ok(scenario.postApplySteps?.length > 0, scenario.name)
    }
  })

  test('preserves the original eight recipes as the exhaustive backstop', () => {
    assert.equal(SCAFFOLD_EXHAUSTIVE_SCENARIOS.length, 8)
    assert.deepEqual(
      SCAFFOLD_EXHAUSTIVE_SCENARIOS.map((scenario) => scenario.name),
      [
        'single-locale-en',
        'route-progress-disabled',
        'storybook-disabled-install-before',
        'storybook-disabled-manual-verify-after',
        'admin-console-path-panel',
        'admin-console-host-panel',
        'admin-console-single-locale-ru-host-panel',
        'admin-console-single-locale-en-disabled',
      ]
    )
  })

  test('regression: Storybook manual verification includes the API test in the real order', () => {
    assert.equal(STORYBOOK_DISABLED_MANUAL_SCENARIO.postApplySteps, STORYBOOK_MANUAL_VERIFY_STEPS)
    assert.deepEqual(STORYBOOK_MANUAL_VERIFY_STEPS, [
      ['typecheck'],
      ['lint'],
      ['--filter', 'web', 'build'],
      ['--filter', 'api', 'test'],
      ['--filter', 'web', 'test'],
    ])
  })
})
