import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { parse } from 'yaml'
import {
  requiredCiJobs,
  requireCompleteCi,
  requireSelectedCi,
  coarseExecution,
} from './ci-required.mjs'

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
    role: 'upstream-starter',
    mode: 'normal',
    diffComplete: true,
    integration: false,
  }
  const inputs = {
    role: identity.role,
    mode: identity.mode,
    areas: { common: true },
    diffComplete: true,
    integration: false,
  }
  const plan = {
    repository: identity.repository,
    event: identity.event,
    source: identity.source,
    run: identity.run,
    attempt: identity.attempt,
    version: 2,
    phase: 'coarse',
    inputs,
    ...coarseExecution(inputs),
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
  // Exercise the real CLI for every aggregate, including the legitimate skip branch.
  const narrowInputs = { ...inputs, areas: { ui: true } }
  const narrow = { ...plan, inputs: narrowInputs, ...coarseExecution(narrowInputs) }
  const scopeJobs = {
    all: requiredCiJobs,
    test: ['test-unit-redis', 'test-capability', 'test-notification-ai', 'api-e2e'],
    api: ['api-e2e-plan', 'api-e2e-shards'],
  }
  for (const [scope, jobs] of Object.entries(scopeJobs)) {
    const results = {
      'ci-selection': { result: 'success' },
      ...Object.fromEntries(
        jobs.map((job) => [
          job,
          {
            result: narrow.effective.includes(job) ? 'success' : 'skipped',
          },
        ])
      ),
    }
    const invoke = (values, execution = narrow) =>
      spawnSync(process.execPath, ['scripts/ci-required.mjs', scope], {
        encoding: 'utf8',
        env: {
          ...env,
          CI_RESULTS: JSON.stringify(values),
          CI_PLAN: JSON.stringify(execution),
        },
      })
    assert.equal(invoke(results).status, 0)
    for (const job of jobs) {
      const failed = invoke({ ...results, [job]: { result: 'cancelled' } })
      assert.equal(failed.status, 1, `${scope}/${job}`)
    }
    assert.equal(invoke(results, { ...narrow, effective: ['lint'] }).status, 1)
    assert.equal(invoke({ ...results, 'ci-selection': { result: 'skipped' } }).status, 1)
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
    () => requireSelectedCi({ ...broad(), 'ci-selection': { result: 'failure' } }, plan, identity),
    /selector/
  )
  for (const job of requiredCiJobs) {
    const failed = { ...broad(), [job]: { result: 'skipped' } }
    assert.throws(() => requireSelectedCi(failed, plan, identity), /disagree with execution plan/)
  }
})

test('coarse execution admits only complete independent UI/web and preserves browser and Redis', () => {
  const inputs = {
    role: 'upstream-starter',
    mode: 'normal',
    areas: { ui: true },
    diffComplete: true,
    integration: false,
  }
  for (const areas of [{ ui: true }, { web: true }, { ui: true, web: true }]) {
    const actual = coarseExecution({ ...inputs, areas })
    assert.equal(actual.reason, 'independent-web')
    assert.equal(actual.effective.length, 12)
    for (const job of [
      'test-unit-redis',
      'test',
      'api-e2e',
      'web-e2e-plan',
      'web-e2e-lanes',
      'web-e2e',
      'storybook',
    ])
      assert.ok(actual.effective.includes(job))
  }
  for (const extra of [
    { mode: 'full' },
    { diffComplete: false },
    { integration: true },
    { areas: {} },
    ...[
      'docs',
      'api',
      'common',
      'infra',
      'monitoring',
      'tools',
      'email',
      'deployment',
      'unknown',
    ].map((area) => ({ areas: { ui: true, [area]: true } })),
  ])
    assert.deepEqual(coarseExecution({ ...inputs, ...extra }).effective, requiredCiJobs)
  for (const extra of [{ role: 'downstream-product' }, { mode: 'heavy-off' }])
    assert.throws(() => coarseExecution({ ...inputs, ...extra }))
})

test('all scopes reject lost selected work, unexpected execution and forged admission', () => {
  const inputs = {
    role: 'upstream-starter',
    mode: 'normal',
    areas: { web: true },
    diffComplete: true,
    integration: false,
  }
  const identity = {
    ...inputs,
    repository: 'owner/repository',
    event: 'push',
    source: { head: 'a'.repeat(40), base: 'b'.repeat(40) },
    run: '123',
    attempt: '1',
  }
  const plan = {
    repository: identity.repository,
    event: identity.event,
    source: identity.source,
    run: identity.run,
    attempt: identity.attempt,
    version: 2,
    phase: 'coarse',
    inputs,
    ...coarseExecution(inputs),
  }
  const scopes = {
    all: requiredCiJobs,
    test: ['test-unit-redis', 'test-capability', 'test-notification-ai', 'api-e2e'],
    api: ['api-e2e-plan', 'api-e2e-shards'],
  }
  for (const [scope, jobs] of Object.entries(scopes)) {
    const results = {
      'ci-selection': { result: 'success' },
      ...Object.fromEntries(
        jobs.map((job) => [
          job,
          {
            result: plan.effective.includes(job) ? 'success' : 'skipped',
          },
        ])
      ),
    }
    assert.doesNotThrow(() => requireSelectedCi(results, plan, identity, scope))
    for (const job of ['ci-selection', ...jobs]) {
      for (const result of ['failure', 'cancelled', 'skipped', 'success', 'neutral', undefined]) {
        if (result === results[job].result) continue
        assert.throws(() =>
          requireSelectedCi({ ...results, [job]: { result } }, plan, identity, scope)
        )
      }
      const missing = { ...results }
      delete missing[job]
      assert.throws(() => requireSelectedCi(missing, plan, identity, scope))
    }
    assert.throws(() =>
      requireSelectedCi({ ...results, unexpected: { result: 'success' } }, plan, identity, scope)
    )
    for (const mutation of [
      { effective: ['lint'] },
      { reason: 'broad' },
      { proposed: {} },
      { version: 1 },
      { phase: 'broad' },
      { run: '124' },
      { attempt: '2' },
      { repository: 'other/repository' },
      { event: 'pull_request' },
      { source: { ...identity.source, head: 'c'.repeat(40) } },
      { source: { ...identity.source, base: 'c'.repeat(40) } },
      ...['role', 'mode', 'diffComplete', 'integration'].map((key) => ({
        inputs: {
          ...inputs,
          [key]: key === 'role' ? 'downstream-product' : key === 'mode' ? 'full' : !inputs[key],
        },
      })),
    ])
      assert.throws(() => requireSelectedCi(results, { ...plan, ...mutation }, identity, scope))
  }
})
