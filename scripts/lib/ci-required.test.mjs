import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { selectCiGroups } from './ci-selection.mjs'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { parse } from 'yaml'
import { requiredCiJobs, requireCompleteCi, requireBridgeCi } from './ci-required.mjs'

const successful = () =>
  Object.fromEntries(requiredCiJobs.map((name) => [name, { result: 'success' }]))

test('admission covers every workflow job, including browser and component families', () => {
  const { jobs } = parse(readFileSync('.github/workflows/ci.yml', 'utf8'))
  assert.deepEqual(
    Object.keys(jobs)
      .filter((name) => !['ci-required', 'ci-selection'].includes(name))
      .sort(),
    [...requiredCiJobs].sort()
  )
  assert.deepEqual(
    [...jobs['ci-required'].needs].sort(),
    [...requiredCiJobs, 'ci-selection'].sort()
  )
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

test('the actual gate command rejects malformed input and propagates the failure exit', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-bridge-gate-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const event = join(dir, 'event.json')
  writeFileSync(event, JSON.stringify({ before: head }))
  const identity = {
    repository: 'alex-morozov84/AMCore',
    event: 'push',
    source: { head, base: head },
    run: '123',
    attempt: '1',
  }
  const plan = {
    ...identity,
    version: 1,
    phase: 'broad',
    effective: [...requiredCiJobs],
    proposed: selectCiGroups({
      role: 'upstream-starter',
      mode: 'normal',
      areas: { ui: true },
      diffComplete: true,
    }),
  }
  const env = {
    ...process.env,
    GITHUB_EVENT_PATH: event,
    GITHUB_SHA: head,
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REPOSITORY: identity.repository,
    GITHUB_RUN_ID: identity.run,
    GITHUB_RUN_ATTEMPT: identity.attempt,
    CI_PLAN: JSON.stringify(plan),
  }
  const broad = () => ({ 'ci-selection': { result: 'success' }, ...successful() })
  const missing = broad()
  delete missing.storybook
  for (const value of [
    '',
    'null',
    '[]',
    '{}',
    '{',
    JSON.stringify({ ...broad(), storybook: { result: 'skipped' } }),
    JSON.stringify(missing),
    JSON.stringify({ ...broad(), unexpected: { result: 'success' } }),
  ]) {
    const result = spawnSync(process.execPath, ['scripts/ci-required.mjs'], {
      env: { ...env, CI_RESULTS: value },
      encoding: 'utf8',
    })
    assert.equal(result.status, 1, value)
  }
  const result = spawnSync(process.execPath, ['scripts/ci-required.mjs'], {
    env: { ...env, CI_RESULTS: JSON.stringify(broad()) },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  for (const mutation of [
    { ...plan, phase: 'selected' },
    { ...plan, effective: ['lint'] },
    { ...plan, proposed: {} },
    { ...plan, attempt: '2' },
    { ...plan, source: { ...plan.source, head: 'f'.repeat(40) } },
  ]) {
    const failed = spawnSync(process.execPath, ['scripts/ci-required.mjs'], {
      env: { ...env, CI_RESULTS: JSON.stringify(broad()), CI_PLAN: JSON.stringify(mutation) },
    })
    assert.equal(failed.status, 1)
  }
  assert.throws(
    () => requireBridgeCi({ ...broad(), 'ci-selection': { result: 'failure' } }, plan, identity),
    /selector/
  )
  for (const job of requiredCiJobs) {
    const failed = { ...broad(), [job]: { result: 'skipped' } }
    assert.throws(() => requireBridgeCi(failed, plan, identity), /did not succeed/)
  }
})
