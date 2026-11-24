import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  git('init', '-q')
  writeFileSync(join(dir, 'PROJECT_CONTEXT.md'), '- **Mode:** `upstream-starter`\n')
  git('add', 'PROJECT_CONTEXT.md')
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-qm',
    'fixture'
  )
  const head = git('rev-parse', 'HEAD')
  const command = new URL('../ci-required.mjs', import.meta.url)
  const run = (args, options) =>
    spawnSync(process.execPath, [fileURLToPath(command), ...args], {
      cwd: dir,
      ...options,
    })
  const event = join(dir, 'event.json')
  writeFileSync(event, JSON.stringify({ before: head }))
  const identity = {
    repository: 'alex-morozov84/AMCore',
    event: 'push',
    source: { head, base: head, checkout: head },
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
    version: 3,
    phase: 'selection',
    inputs,
    ...coarseExecution(inputs, identity.event),
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
  const broad = () => ({
    'ci-selection': { result: 'success' },
    ...Object.fromEntries(
      requiredCiJobs.map((job) => [
        job,
        { result: plan.effective.includes(job) ? 'success' : 'skipped' },
      ])
    ),
  })
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
    const result = run([], {
      env: { ...env, CI_RESULTS: value },
      encoding: 'utf8',
    })
    assert.equal(result.status, 1, value)
  }
  // Exercise the real CLI for every aggregate, including the legitimate skip branch.
  const narrowInputs = { ...inputs, areas: { ui: true } }
  const narrow = { ...plan, inputs: narrowInputs, ...coarseExecution(narrowInputs, identity.event) }
  const scopeJobs = {
    all: requiredCiJobs,
    test: ['test-unit', 'test-redis', 'test-capability', 'test-notification-ai', 'api-e2e'],
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
      run([scope], {
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
  const result = run([], {
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
    const failed = run([], {
      env: { ...env, CI_RESULTS: JSON.stringify(broad()), CI_PLAN: JSON.stringify(mutation) },
    })
    assert.equal(failed.status, 1)
  }
  // Mark the fixture's sole commit as a shallow boundary, as in the CI checkout.
  writeFileSync(join(dir, '.git', 'shallow'), head + '\n')
  const incomplete = { ...inputs, diffComplete: false, areas: { ui: true } }
  const shallow = run([], {
    env: {
      ...env,
      CI_RESULTS: JSON.stringify(broad()),
      CI_PLAN: JSON.stringify({
        ...plan,
        inputs: incomplete,
        ...coarseExecution(incomplete, identity.event),
      }),
    },
    encoding: 'utf8',
  })
  assert.equal(shallow.status, 0, shallow.stderr)
  const falselyComplete = run([], {
    env: { ...env, CI_RESULTS: JSON.stringify(broad()) },
    encoding: 'utf8',
  })
  assert.equal(falselyComplete.status, 1)
  assert.match(falselyComplete.stderr, /admission inputs disagree/)
  assert.throws(
    () => requireSelectedCi({ ...broad(), 'ci-selection': { result: 'failure' } }, plan, identity),
    /selector/
  )
  for (const job of plan.effective) {
    const failed = { ...broad(), [job]: { result: 'skipped' } }
    assert.throws(() => requireSelectedCi(failed, plan, identity), /disagree with execution plan/)
  }
})

test('ordinary web, isolated API suite and intentional heavy-off select different jobs', () => {
  const inputs = {
    role: 'downstream-product',
    mode: 'normal',
    areas: { web: true },
    diffComplete: true,
    integration: false,
  }
  const web = coarseExecution(inputs).effective
  for (const job of ['test-unit', 'test-redis', 'web-e2e', 'storybook'])
    assert.ok(web.includes(job))
  assert.ok(!web.includes('api-e2e'))
  assert.deepEqual(coarseExecution({ ...inputs, areas: { apiE2e: true } }).effective, [
    'lint',
    'typecheck',
    'test',
    'api-e2e-plan',
    'api-e2e-shards',
    'api-e2e',
    'promtool',
  ])
  const off = coarseExecution({ ...inputs, mode: 'heavy-off' }).effective
  assert.deepEqual(off, ['lint', 'typecheck', 'test-unit', 'test', 'promtool'])
  assert.throws(() => coarseExecution({ ...inputs, mode: 'heavy-off', role: 'upstream-starter' }))
  for (const extra of [
    { diffComplete: false },
    { integration: true },
    { areas: { unknown: true } },
    { mode: 'full' },
  ])
    assert.deepEqual(
      coarseExecution({ ...inputs, role: 'upstream-starter', ...extra }).effective,
      requiredCiJobs
    )
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
    version: 3,
    phase: 'selection',
    inputs,
    ...coarseExecution(inputs, identity.event),
  }
  const scopes = {
    all: requiredCiJobs,
    test: ['test-unit', 'test-redis', 'test-capability', 'test-notification-ai', 'api-e2e'],
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
      ...['role', 'mode', 'integration'].map((key) => ({
        inputs: {
          ...inputs,
          [key]: key === 'role' ? 'downstream-product' : key === 'mode' ? 'full' : !inputs[key],
        },
      })),
    ])
      assert.throws(() => requireSelectedCi(results, { ...plan, ...mutation }, identity, scope))
  }
})

test('unverified push selects applicable checks; verified delivery repeats none', () => {
  const inputs = {
    role: 'upstream-starter',
    mode: 'normal',
    areas: { api: true, email: true, deployment: true },
    diffComplete: true,
    integration: false,
  }
  const push = coarseExecution(inputs, 'push')
  assert.deepEqual(push, coarseExecution(inputs, 'pull_request'))
  assert.ok(push.effective.includes('test-email'))
  assert.ok(push.effective.includes('deployment-version'))
  assert.ok(
    coarseExecution({ ...inputs, diffComplete: false }, 'push').effective.includes(
      'script-contracts'
    )
  )
  assert.deepEqual(
    coarseExecution({ ...inputs, credit: { pull: 1, run: '2', attempt: '1' } }, 'push').effective,
    []
  )
})
