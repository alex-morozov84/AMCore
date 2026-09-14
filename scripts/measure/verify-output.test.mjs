import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseVerificationStages, summarizeVerificationCounters } from './verify-output.mjs'

const FULL_OUTPUT = `
Running post-apply verification...
  - typecheck: OK
  - lint: OK
  - web build: OK
  - api test: OK
  - web test: FAILED
      some failure detail
`

describe('verify-output', () => {
  test('parses every present stage line in order, with its ok/failed status', () => {
    const stages = parseVerificationStages(FULL_OUTPUT)
    assert.deepEqual(stages, [
      { label: 'typecheck', ok: true },
      { label: 'lint', ok: true },
      { label: 'web build', ok: true },
      { label: 'api test', ok: true },
      { label: 'web test', ok: false },
    ])
  })

  test('a label absent from stdout does not appear at all (Storybook-disabled skip, not a parse gap)', () => {
    const stages = parseVerificationStages('Storybook: apps/web/package.json dependencies changed\npnpm install\n')
    assert.deepEqual(stages, [])
  })

  test('summarizeVerificationCounters counts typecheck/lint/build once each, tests summed', () => {
    const counters = summarizeVerificationCounters(parseVerificationStages(FULL_OUTPUT))
    assert.deepEqual(counters, { typecheckRuns: 1, lintRuns: 1, buildRuns: 1, testRuns: 2 })
  })

  test('summarizeVerificationCounters is all-zero when nothing ran', () => {
    assert.deepEqual(summarizeVerificationCounters([]), {
      typecheckRuns: 0,
      lintRuns: 0,
      buildRuns: 0,
      testRuns: 0,
    })
  })

  test('only counts a failed stage as ran (present), not as succeeded', () => {
    const counters = summarizeVerificationCounters(parseVerificationStages(FULL_OUTPUT))
    // "web test" ran (counted in testRuns) even though it failed.
    assert.equal(counters.testRuns, 2)
  })
})
