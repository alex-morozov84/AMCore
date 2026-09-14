import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { deriveApplyOutcome } from './apply-outcome.mjs'

const FULL_SUCCESS_STDOUT = `
  - typecheck: OK
  - lint: OK
  - web build: OK
  - api test: OK
  - web test: OK
`

// Real reportVerification prints each completed stage's line as it goes —
// a failure partway through still leaves the earlier stages' lines present.
const PARTIAL_FAILURE_STDOUT = `
  - typecheck: OK
  - lint: OK
  - web build: OK
  - api test: FAILED
      some real failure output
`

describe('deriveApplyOutcome', () => {
  test('a fully successful run: ok, all counters populated, no failedInternalStage', () => {
    const outcome = deriveApplyOutcome({ status: 0, stdout: FULL_SUCCESS_STDOUT }, 100, 't0')
    assert.equal(outcome.applyStage.ok, true)
    assert.equal(outcome.failedInternalStage, null)
    assert.deepEqual(outcome.counters, { typecheckRuns: 1, lintRuns: 1, buildRuns: 1, testRuns: 2 })
  })

  test('regression (Round 8): partial internal verification survives a failed overall exit', () => {
    // Previously: counters were only merged `if (ok)`, so a CLI exit of 1
    // discarded evidence that typecheck/lint/build had genuinely already
    // passed before the api test failed.
    const outcome = deriveApplyOutcome({ status: 1, stdout: PARTIAL_FAILURE_STDOUT }, 100, 't0')
    assert.deepEqual(outcome.counters, { typecheckRuns: 1, lintRuns: 1, buildRuns: 1, testRuns: 1 })
  })

  test('the specific failed internal stage becomes the diagnostic-bearing record, not the generic "apply"', () => {
    const outcome = deriveApplyOutcome({ status: 1, stdout: PARTIAL_FAILURE_STDOUT }, 100, 't0')
    assert.equal(outcome.failedInternalStage.label, 'api test')
    assert.equal(outcome.failedInternalStage.ok, false)
    assert.match(outcome.failedInternalStage.output, /some real failure output/)
    // The "apply" record itself is still reported (informational context)
    // but carries no diagnostic output of its own.
    assert.equal(outcome.applyStage.label, 'apply')
    assert.equal(outcome.applyStage.ok, false)
    assert.equal(outcome.applyStage.output, '')
  })

  test('a CLI failure with no recognizable internal verify output falls back to the generic "apply" stage', () => {
    // e.g. the plan/transform itself failed before verification ever ran.
    const outcome = deriveApplyOutcome({ status: 1, stdout: '', stderr: 'EngineError: boom' }, 100, 't0')
    assert.equal(outcome.failedInternalStage, null)
    assert.equal(outcome.applyStage.ok, false)
    assert.match(outcome.applyStage.output, /EngineError: boom/)
  })
})
