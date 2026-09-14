import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { SCENARIOS } from './scenario-registry.mjs'
import {
  SCAFFOLD_MEASUREMENT_SCENARIOS,
  STORYBOOK_DISABLED_MANUAL_SCENARIO,
  STORYBOOK_MANUAL_VERIFY_STEPS,
} from '../lib/scaffold-scenario-recipes.mjs'

describe('scenario-registry', () => {
  test('re-exports the exact scenario inputs consumed by the real tests', () => {
    assert.equal(SCENARIOS, SCAFFOLD_MEASUREMENT_SCENARIOS)
  })

  test('contains the independently expected eight named baseline scenarios', () => {
    assert.deepEqual(
      SCENARIOS.map((scenario) => scenario.name),
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

  test('every scenario name is unique and every flag is a string', () => {
    const names = SCENARIOS.map((scenario) => scenario.name)
    assert.deepEqual(names, [...new Set(names)])
    for (const scenario of SCENARIOS)
      assert.ok(scenario.flags.every((flag) => typeof flag === 'string'))
  })

  test('skipVerify scenarios declare an explicit manual verification recipe', () => {
    for (const scenario of SCENARIOS) {
      if (scenario.skipVerify) assert.ok(scenario.postApplySteps?.length > 0, scenario.name)
    }
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
