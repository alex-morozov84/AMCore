import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aggregate } from '../api-e2e/aggregate.mjs'

test('artifact aggregate binds complete evidence to actual checkout and PR head', () => {
  const directory = mkdtempSync(join(tmpdir(), 'api-e2e-artifacts-'))
  const original = process.env.API_E2E_PR_HEAD
  delete process.env.API_E2E_PR_HEAD
  const path = 'test/suite.e2e-spec.ts'
  const plan = {
    schemaVersion: 1,
    sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    inputs: 'b'.repeat(64),
    pullRequestHead: null,
    run: 'run',
    runAttempt: '1',
    all: [path],
    shards: [{ id: '1/1', paths: [path] }],
  }
  const attempt = {
    id: 'a',
    pid: 1,
    absolutePath: '/suite',
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
      { event: 'suite-start', attempt: 'a', pid: 1, path: '/suite' },
      {
        event: 'suite-end',
        attempt: 'a',
        pid: 1,
        path: '/suite',
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
    aggregate(directory, outcomes)
    assert.throws(() => aggregate(directory, { ...outcomes, shards: 'failure' }))
    process.env.API_E2E_PR_HEAD = 'c'.repeat(40)
    assert.throws(() => aggregate(directory, outcomes), /checkout\/PR/)
    delete process.env.API_E2E_PR_HEAD
    save('api-e2e-plan/plan.json', { ...plan, sha: 'd'.repeat(40) })
    assert.throws(() => aggregate(directory, outcomes), /checkout\/PR/)
    save('api-e2e-plan/plan.json', plan)
    rmSync(join(directory, 'api-e2e-report-1-1'), { recursive: true })
    assert.throws(() => aggregate(directory, outcomes), /Missing/)
  } finally {
    if (original === undefined) delete process.env.API_E2E_PR_HEAD
    else process.env.API_E2E_PR_HEAD = original
    rmSync(directory, { recursive: true, force: true })
  }
})
