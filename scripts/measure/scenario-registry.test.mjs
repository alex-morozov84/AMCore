import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { SCENARIOS } from './scenario-registry.mjs'
import {
  STORYBOOK_MANUAL_VERIFY_STEPS,
  ADMIN_CONSOLE_VERIFY_STEPS,
  ADMIN_CONSOLE_ENABLED_TOPOLOGIES,
  ADMIN_CONSOLE_SINGLE_LOCALE_BUILD_STEPS,
  ADMIN_CONSOLE_SINGLE_LOCALE_REPRESENTATIVE_SCENARIOS,
} from '../lib/scaffold-scenario-recipes.mjs'

// Only the four CLI-verified scenarios carry a real `file:line` citation with
// literal flags to check against; derived (admin-console) scenarios are
// covered by the referential-derivation tests below instead.
const CLI_VERIFIED_NAMES = new Set([
  'single-locale-en',
  'route-progress-disabled',
  'storybook-disabled-install-before',
  'storybook-disabled-manual-verify-after',
])

function citedFile(citation) {
  return path.resolve(citation.split(':')[0])
}

describe('scenario-registry: CLI-verified scenarios (real file:line citations)', () => {
  const scenarios = SCENARIOS.filter((s) => CLI_VERIFIED_NAMES.has(s.name))

  test('every non-"--yes" flag cited still appears (verbatim, or by prefix for --locale) in the file it cites', () => {
    for (const scenario of scenarios) {
      const content = readFileSync(citedFile(scenario.citation), 'utf8')
      for (const flag of scenario.flags) {
        if (flag === '--yes') continue
        const needle = flag.startsWith('--locale=') ? '--locale=' : flag
        assert.match(
          content,
          new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          `${scenario.name}: "${needle}" not found in ${scenario.citation} — registry may have drifted from the real test file`
        )
      }
    }
  })

  test('every cited file actually exists', () => {
    for (const scenario of scenarios) {
      assert.doesNotThrow(() => readFileSync(citedFile(scenario.citation), 'utf8'), scenario.citation)
    }
  })
})

describe('scenario-registry: derived (admin-console) scenarios stay structurally identical to the shared recipes', () => {
  test('admin-console scenario count matches ADMIN_CONSOLE_ENABLED_TOPOLOGIES exactly', () => {
    const derived = SCENARIOS.filter((s) => s.name.startsWith('admin-console-') && !s.name.includes('admin-console-single-locale'))
    assert.equal(derived.length, ADMIN_CONSOLE_ENABLED_TOPOLOGIES.length)
  })

  test('every admin-console scenario\'s postApplySteps is the exact shared recipe array, not a copy', () => {
    for (const scenario of SCENARIOS) {
      if (scenario.name.startsWith('admin-console-') && !scenario.name.includes('admin-console-single-locale')) {
        assert.equal(scenario.postApplySteps, ADMIN_CONSOLE_VERIFY_STEPS)
      }
    }
  })

  test('single-locale admin-console scenario count matches ADMIN_CONSOLE_SINGLE_LOCALE_REPRESENTATIVE_SCENARIOS exactly', () => {
    const derived = SCENARIOS.filter((s) => s.name.includes('admin-console-single-locale'))
    assert.equal(derived.length, ADMIN_CONSOLE_SINGLE_LOCALE_REPRESENTATIVE_SCENARIOS.length)
  })

  test('every single-locale admin-console scenario\'s postApplySteps is the exact shared recipe array, not a copy', () => {
    for (const scenario of SCENARIOS) {
      if (scenario.name.includes('admin-console-single-locale')) {
        assert.equal(scenario.postApplySteps, ADMIN_CONSOLE_SINGLE_LOCALE_BUILD_STEPS)
      }
    }
  })
})

describe('scenario-registry: regression — the exact Storybook drift Round 8 found', () => {
  test('the Storybook manual-verify recipe includes the API test step, in the real order', () => {
    // BACKLOG item 14, PR1 Round 8: a hand-typed copy here previously ran
    // typecheck/lint/web-test/web-build, silently omitting `--filter api test`
    // and reordering web-test before web-build. Asserting the imported
    // recipe directly — not a second hand-typed expectation — so this can
    // never again pass while under-measuring the real scenario.
    assert.deepEqual(STORYBOOK_MANUAL_VERIFY_STEPS, [
      ['typecheck'],
      ['lint'],
      ['--filter', 'web', 'build'],
      ['--filter', 'api', 'test'],
      ['--filter', 'web', 'test'],
    ])
  })

  test('the registered storybook-disabled-manual-verify-after scenario uses that exact recipe', () => {
    const scenario = SCENARIOS.find((s) => s.name === 'storybook-disabled-manual-verify-after')
    assert.equal(scenario.postApplySteps, STORYBOOK_MANUAL_VERIFY_STEPS)
  })
})

describe('scenario-registry: general invariants', () => {
  test('every scenario name is unique', () => {
    const names = SCENARIOS.map((s) => s.name)
    assert.deepEqual(names, [...new Set(names)])
  })

  test('skipVerify=true always pairs with an explicit manual postApplySteps verify path', () => {
    for (const scenario of SCENARIOS) {
      if (!scenario.skipVerify) continue
      const hasManual = Array.isArray(scenario.postApplySteps) && scenario.postApplySteps.length > 0
      assert.ok(hasManual, `${scenario.name}: skipVerify without any manual verify path — silently unverified`)
    }
  })
})
