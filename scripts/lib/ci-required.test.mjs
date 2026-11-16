import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { parse } from 'yaml'
import { requiredCiJobs, requireCompleteCi } from './ci-required.mjs'

const successful = () =>
  Object.fromEntries(requiredCiJobs.map((name) => [name, { result: 'success' }]))

test('admission covers every workflow job, including browser and component families', () => {
  const { jobs } = parse(readFileSync('.github/workflows/ci.yml', 'utf8'))
  assert.deepEqual(
    Object.keys(jobs)
      .filter((name) => name !== 'ci-required')
      .sort(),
    [...requiredCiJobs].sort()
  )
  assert.deepEqual([...jobs['ci-required'].needs].sort(), [...requiredCiJobs].sort())
  assert.equal(jobs['ci-required'].if, '${{ always() }}')
  const step = jobs['ci-required'].steps.find((entry) => entry.run)
  assert.equal(step.env.CI_RESULTS, '${{ toJSON(needs) }}')
  assert.equal(step.run, 'node scripts/ci-required.mjs')
  assert.doesNotThrow(() => requireCompleteCi(successful()))
})

test('one lost, cancelled, failed or skipped family cannot be hidden by the other successes', () => {
  for (const name of requiredCiJobs) {
    for (const result of ['failure', 'cancelled', 'skipped', 'neutral', undefined]) {
      assert.throws(
        () => requireCompleteCi({ ...successful(), [name]: { result } }),
        /did not succeed/
      )
    }
    const missing = successful()
    delete missing[name]
    assert.throws(() => requireCompleteCi(missing), /inventory/)
  }
  assert.throws(
    () => requireCompleteCi({ ...successful(), unexpected: { result: 'success' } }),
    /inventory/
  )
})

test('the actual gate command rejects malformed input and propagates the failure exit', () => {
  const missing = successful()
  delete missing.storybook
  for (const value of [
    '',
    'null',
    '[]',
    '{}',
    '{',
    JSON.stringify({ ...successful(), storybook: { result: 'skipped' } }),
    JSON.stringify(missing),
    JSON.stringify({ ...successful(), unexpected: { result: 'success' } }),
  ]) {
    const result = spawnSync(process.execPath, ['scripts/ci-required.mjs'], {
      env: { ...process.env, CI_RESULTS: value },
      encoding: 'utf8',
    })
    assert.equal(result.status, 1, value)
  }
  const result = spawnSync(process.execPath, ['scripts/ci-required.mjs'], {
    env: { ...process.env, CI_RESULTS: JSON.stringify(successful()) },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
})
