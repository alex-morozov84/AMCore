import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aggregate } from '../api-e2e/aggregate.mjs'

function attempt(path, pid) {
  const id = `suite-${pid}`,
    absolutePath = `/runner/apps/api/${path}`
  const row = (event, extra = {}) => ({ event, attempt: id, pid, ...extra })
  return {
    id,
    pid,
    path,
    absolutePath,
    closed: true,
    forced: false,
    lifecycleFailure: false,
    signal: null,
    spawns: 1,
    exit: 0,
    clean: true,
    final: { success: true },
    rows: [
      row('run-start'),
      row('suite-start', { path: absolutePath }),
      row('suite-end', {
        path: absolutePath,
        runtimeError: false,
        failure: false,
        assertions: [{ status: 'passed', invocations: 1, retryReasons: [] }],
      }),
      row('terminal', { success: true }),
    ],
  }
}

test('three-shard current attempt succeeds; stale, incomplete and ambiguous artifacts fail', () => {
  const directory = mkdtempSync(join(tmpdir(), 'api-e2e-attempt-'))
  const keys = ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_ACTIONS', 'API_E2E_PR_HEAD']
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  const all = [1, 2, 3].map((i) => `test/suite-${i}.e2e-spec.ts`)
  const plan = {
    schemaVersion: 1,
    sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    inputs: 'b'.repeat(64),
    pullRequestHead: null,
    run: '123',
    runAttempt: '2',
    all,
    shards: all.map((path, i) => ({ id: `${i + 1}/3`, paths: [path] })),
  }
  const outcomes = { plan: 'success', shards: 'success' }
  const save = (name, value) => {
    const file = join(directory, name)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify(value))
  }
  const populate = () => {
    save('api-e2e-attempt-2-plan/plan.json', plan)
    for (const [i, shard] of plan.shards.entries()) {
      const name = `api-e2e-attempt-2-report-${i + 1}-3`
      save(`${name}/plan.json`, plan)
      save(`${name}/${i + 1}-3/report.json`, {
        ...plan,
        shard: shard.id,
        paths: shard.paths,
        success: true,
        attempts: [attempt(shard.paths[0], i + 1)],
      })
    }
  }
  const check = () => aggregate(directory, outcomes)
  const reset = () => {
    rmSync(directory, { recursive: true })
    mkdirSync(directory)
    populate()
  }
  try {
    process.env.GITHUB_RUN_ID = '123'
    process.env.GITHUB_RUN_ATTEMPT = '2'
    process.env.GITHUB_ACTIONS = 'true'
    delete process.env.API_E2E_PR_HEAD
    populate()
    check()
    process.env.GITHUB_RUN_ATTEMPT = '3'
    assert.throws(check, /ENOENT/) // Only previous-attempt artifacts exist.
    process.env.GITHUB_RUN_ATTEMPT = '2'
    renameSync(
      join(directory, 'api-e2e-attempt-2-report-1-3'),
      join(directory, 'api-e2e-attempt-1-report-1-3')
    )
    assert.throws(check, /Unexpected/)
    reset()
    save('api-e2e-attempt-2-report-1-3/plan.json', { ...plan, runAttempt: '1' })
    assert.throws(check, /Shard plan/)
    reset()
    rmSync(join(directory, 'api-e2e-attempt-2-report-1-3'), { recursive: true })
    assert.throws(check, /Missing/)
    reset()
    for (const extra of ['report-4-3', 'report-1-3-copy', 'unexpected']) {
      mkdirSync(join(directory, `api-e2e-attempt-2-${extra}`))
      assert.throws(check, /Unexpected/)
      reset()
    }
    for (const field of ['sha', 'inputs', 'run', 'runAttempt']) {
      const shard = plan.shards[0]
      save('api-e2e-attempt-2-report-1-3/1-3/report.json', {
        ...plan,
        [field]: 'wrong',
        shard: shard.id,
        paths: shard.paths,
        success: true,
        attempts: [attempt(shard.paths[0], 1)],
      })
      assert.throws(check, /provenance/)
      reset()
    }
    save('api-e2e-attempt-2-plan/plan.json', { ...plan, run: 'other' })
    assert.throws(check, /workflow run/)
    reset()
    process.env.API_E2E_PR_HEAD = 'c'.repeat(40)
    assert.throws(check, /checkout\/PR/)
    delete process.env.API_E2E_PR_HEAD
    rmSync(directory, { recursive: true })
    mkdirSync(directory)
    save('plan.json', plan) // download-artifact flattens a single matching artifact.
    assert.throws(check, /ENOENT/)
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(directory, { recursive: true, force: true })
  }
})
