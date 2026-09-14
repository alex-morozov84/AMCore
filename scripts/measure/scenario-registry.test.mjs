import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { SCENARIOS } from './scenario-registry.mjs'

function citedFile(citation) {
  return path.resolve(citation.split(':')[0])
}

describe('scenario-registry', () => {
  test('every scenario name is unique', () => {
    const names = SCENARIOS.map((s) => s.name)
    assert.deepEqual(names, [...new Set(names)])
  })

  test('every non-"--yes" flag cited still appears (verbatim, or by prefix for --locale) in the file it cites', () => {
    // --locale is parameterized via a template literal (`--locale=${locale}`)
    // in some real test files, so only its flag name — not the specific
    // value — is checked verbatim there. Every other flag is matched exactly.
    for (const scenario of SCENARIOS) {
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
    for (const scenario of SCENARIOS) {
      assert.doesNotThrow(() => readFileSync(citedFile(scenario.citation), 'utf8'), scenario.citation)
    }
  })

  test('skipVerify=true always pairs with an explicit manual postApplySteps verify path', () => {
    for (const scenario of SCENARIOS) {
      if (!scenario.skipVerify) continue
      const hasManual = Array.isArray(scenario.postApplySteps) && scenario.postApplySteps.length > 0
      assert.ok(hasManual, `${scenario.name}: skipVerify without any manual verify path — silently unverified`)
    }
  })
})
