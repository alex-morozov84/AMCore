import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateAttempt, validateReports } from '../api-e2e/validate.mjs'

function valid() {
  return {
    id: 'a',
    pid: 1,
    absolutePath: '/workspace/apps/api/test/suite.e2e-spec.ts',
    path: 'test/suite.e2e-spec.ts',
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
}
test('late green cannot conceal forced stop, missing evidence, retry or replay', () => {
  validateAttempt(valid())
  for (const change of [
    { forced: true },
    { forced: undefined },
    { lifecycleFailure: undefined },
    { signal: undefined },
    { pid: undefined },
    { signal: 'SIGTERM' },
    { closed: false },
    { spawns: 2 },
    { clean: false },
  ]) {
    assert.throws(() => validateAttempt({ ...valid(), ...change }))
  }
  for (const change of [
    { invocations: 2 },
    { invocations: undefined },
    { retryReasons: ['prior failure'] },
    { status: 'pending' },
  ]) {
    const data = valid()
    Object.assign(data.rows[2].assertions[0], change)
    assert.throws(() => validateAttempt(data))
  }
  const duplicate = valid()
  duplicate.rows.push(duplicate.rows[1])
  assert.throws(() => validateAttempt(duplicate))
  const extraTerminal = valid()
  extraTerminal.rows.push({ event: 'terminal', attempt: 'a', pid: 1, success: false })
  assert.throws(() => validateAttempt(extraTerminal))
  const missingPid = valid()
  delete missingPid.rows[2].pid
  assert.throws(() => validateAttempt(missingPid))
  const empty = valid()
  empty.rows[2].assertions = []
  empty.rows[2].runtimeError = true
  assert.throws(() => validateAttempt(empty))
})
test('aggregate rejects omitted, duplicate, unexpected or wrong-SHA shard reports', () => {
  const plan = {
    schemaVersion: 1,
    sha: 'a'.repeat(40),
    inputs: 'b'.repeat(64),
    pullRequestHead: null,
    all: ['test/suite.e2e-spec.ts'],
    run: 'run',
    runAttempt: '1',
    shards: [{ id: '1/1', paths: ['test/suite.e2e-spec.ts'] }],
  }
  const report = {
    ...plan,
    shard: '1/1',
    paths: ['test/suite.e2e-spec.ts'],
    success: true,
    attempts: [valid()],
  }
  validateReports(plan, [report])
  assert.throws(() => validateReports({ ...plan, all: [], shards: [] }, []))
  assert.throws(() => validateReports({ ...plan, all: [] }, [report]))
  for (const reports of [
    [],
    [report, report],
    [{ ...report, sha: 'other' }],
    [{ ...report, pullRequestHead: 'c'.repeat(40) }],
    [{ ...report, schemaVersion: undefined }],
    [{ ...report, success: false }],
    [{ ...report, paths: [] }],
    [{ ...report, attempts: [] }],
  ])
    assert.throws(() => validateReports(plan, reports))
})

test('CI full coverage retains original focused obligations and strict aggregate', async () => {
  const { readFileSync } = await import('node:fs')
  const { root } = await import('../api-e2e/paths.mjs')
  const workflow = readFileSync(`${root}/.github/workflows/ci.yml`, 'utf8')
  assert.equal((workflow.match(/name: API E2E\n/g) || []).length, 1)
  assert.match(
    workflow,
    /api-e2e:\n[\s\S]*?needs: \[api-e2e-plan, api-e2e-shards\]\n {4}if: \$\{\{ always\(\) \}\}/
  )
  assert.match(workflow, /fail-fast: false/)
  assert.match(workflow, /node scripts\/api-e2e\/aggregate.mjs api-e2e-evidence/)
  assert.equal((workflow.match(/node scripts\/api-e2e-ci.mjs --prepare/g) || []).length, 3)
  assert.match(
    workflow,
    /pnpm --filter api test:e2e --runTestsByPath test\/process-role.e2e-spec.ts/
  )
})
