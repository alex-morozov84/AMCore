import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aggregate } from '../api-e2e/aggregate.mjs'

test('artifact aggregate binds complete evidence to actual checkout and PR head', () => {
  const directory = mkdtempSync(join(tmpdir(), 'api-e2e-artifacts-'))
  const originalContext = Object.fromEntries(
    ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_ACTIONS'].map((key) => [key, process.env[key]])
  )
  for (const key of Object.keys(originalContext)) delete process.env[key]
  const original = process.env.API_E2E_PR_HEAD
  delete process.env.API_E2E_PR_HEAD
  const path = 'test/suite.e2e-spec.ts'
  const plan = {
    schemaVersion: 1,
    sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    inputs: 'b'.repeat(64),
    pullRequestHead: null,
    run: 'local',
    runAttempt: '1',
    all: [path],
    shards: [{ id: '1/1', paths: [path] }],
  }
  const attempt = {
    id: 'a',
    pid: 1,
    absolutePath: '/workspace/apps/api/test/suite.e2e-spec.ts',
    path,
    closed: true,
    forced: false,
    lifecycleFailure: false,
    signal: null,
    spawns: 1,
    exit: 0,
    clean: true,
    final: { success: true },
    rows: [
      { event: 'run-start', attempt: 'a', pid: 1 },
      {
        event: 'suite-start',
        attempt: 'a',
        pid: 1,
        path: '/workspace/apps/api/test/suite.e2e-spec.ts',
      },
      {
        event: 'suite-end',
        attempt: 'a',
        pid: 1,
        path: '/workspace/apps/api/test/suite.e2e-spec.ts',
        runtimeError: false,
        failure: false,
        assertions: [{ status: 'passed', invocations: 1, retryReasons: [] }],
      },
      { event: 'terminal', attempt: 'a', pid: 1, success: true },
    ],
  }
  const outcomes = { plan: 'success', shards: 'success' }
  const save = (name, value) => writeFileSync(join(directory, name), JSON.stringify(value))
  try {
    mkdirSync(join(directory, 'api-e2e-plan'))
    mkdirSync(join(directory, 'api-e2e-report-1-1/1-1'), { recursive: true })
    save('api-e2e-plan/plan.json', plan)
    save('api-e2e-report-1-1/plan.json', plan)
    const report = { ...plan, shard: '1/1', paths: [path], success: true, attempts: [attempt] }
    save('api-e2e-report-1-1/1-1/report.json', report)
    aggregate(directory, outcomes, { mode: 'local' })
    assert.throws(() => aggregate(directory, outcomes), /workflow run/)
    const originalRun = process.env.GITHUB_RUN_ID,
      originalAttempt = process.env.GITHUB_RUN_ATTEMPT
    try {
      process.env.GITHUB_RUN_ID = plan.run
      process.env.GITHUB_RUN_ATTEMPT = plan.runAttempt
      aggregate(directory, outcomes)
      process.env.GITHUB_RUN_ID = 'old-run'
      assert.throws(() => aggregate(directory, outcomes), /workflow run/)
      process.env.GITHUB_RUN_ID = plan.run
      process.env.GITHUB_RUN_ATTEMPT = '999'
      assert.throws(() => aggregate(directory, outcomes), /workflow run/)
      assert.throws(() => aggregate(directory, outcomes, { mode: 'local' }), /local artifact/)
    } finally {
      if (originalRun === undefined) delete process.env.GITHUB_RUN_ID
      else process.env.GITHUB_RUN_ID = originalRun
      if (originalAttempt === undefined) delete process.env.GITHUB_RUN_ATTEMPT
      else process.env.GITHUB_RUN_ATTEMPT = originalAttempt
    }

    assert.throws(() => aggregate(directory, { ...outcomes, shards: 'failure' }, { mode: 'local' }))
    process.env.API_E2E_PR_HEAD = 'c'.repeat(40)
    assert.throws(() => aggregate(directory, outcomes, { mode: 'local' }), /checkout\/PR/)
    delete process.env.API_E2E_PR_HEAD
    save('api-e2e-plan/plan.json', { ...plan, sha: 'd'.repeat(40) })
    assert.throws(() => aggregate(directory, outcomes, { mode: 'local' }), /checkout\/PR/)
    save('api-e2e-plan/plan.json', plan)
    rmSync(join(directory, 'api-e2e-report-1-1'), { recursive: true })
    assert.throws(() => aggregate(directory, outcomes, { mode: 'local' }), /Missing/)
  } finally {
    for (const [key, value] of Object.entries(originalContext)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    if (original === undefined) delete process.env.API_E2E_PR_HEAD
    else process.env.API_E2E_PR_HEAD = original
    rmSync(directory, { recursive: true, force: true })
  }
})
