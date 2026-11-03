import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertCurrentPlan } from '../ci-plan-context.mjs'

test('planner recovery admits a complete new family and refuses inherited/wrong-source identity', () => {
  const env = { GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: 'a'.repeat(40) }
  for (const plan of [
    { run: '123', runAttempt: '2', sha: env.GITHUB_SHA },
    { run: '123', attempt: '2', source: env.GITHUB_SHA },
  ]) {
    assert.doesNotThrow(() => assertCurrentPlan(plan, env, env.GITHUB_SHA))
    for (const change of [
      { run: 'other' },
      { runAttempt: '1', attempt: '1' },
      { sha: 'b'.repeat(40), source: 'b'.repeat(40) },
    ])
      assert.throws(
        () => assertCurrentPlan({ ...plan, ...change }, env, env.GITHUB_SHA),
        /rerun.*plan.*dependent/
      )
    assert.throws(() => assertCurrentPlan(plan, env, 'b'.repeat(40)), /Stale/)
  }
  assert.throws(() => assertCurrentPlan(null, env, env.GITHUB_SHA), /missing/)
  assert.throws(() => assertCurrentPlan({}, {}, ''), /missing/)
})
