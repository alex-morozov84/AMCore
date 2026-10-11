import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { validateReports } from '../api-e2e/validate.mjs'
import { root } from '../api-e2e/paths.mjs'

function preparation(jobs) {
  for (const job of Object.values(jobs)) {
    let installed = false,
      prepared = false
    for (const step of job.steps || [])
      for (const line of (step.run || '').split('\n')) {
        if (/pnpm install --frozen-lockfile/.test(line)) installed = true
        if (/node scripts\/api-e2e-ci.mjs --prepare/.test(line)) {
          assert.ok(
            installed && !step.if && !step['continue-on-error'],
            'fresh unconditional preparation'
          )
          prepared = true
        } else if (
          /node scripts\/api-e2e-ci.mjs|pnpm --filter api test:e2e|pnpm test:background-work-contracts/.test(
            line
          )
        ) {
          assert.ok(prepared, 'wrapper execution requires preparation in its own job')
        }
      }
  }
}
test('F1 every fresh wrapper job prepares before execution; missing/late/skipped preparation fails', () => {
  const jobs = parse(readFileSync(`${root}/.github/workflows/ci.yml`, 'utf8')).jobs
  preparation(jobs)
  for (const change of ['missing', 'late', 'skipped']) {
    const bad = structuredClone(jobs)
    const index = bad.test.steps.findIndex((step) =>
      /api-e2e-ci.mjs --prepare/.test(step.run || '')
    )
    const [step] = bad.test.steps.splice(index, 1)
    if (change === 'late') bad.test.steps.push(step)
    if (change === 'skipped') bad.test.steps.splice(index, 0, { ...step, if: 'false' })
    assert.throws(() => preparation(bad))
  }
})
function evidence() {
  const all = ['test/first.e2e-spec.ts', 'test/second.e2e-spec.ts']
  const plan = {
    schemaVersion: 1,
    sha: 'a'.repeat(40),
    inputs: 'b'.repeat(64),
    pullRequestHead: null,
    run: 'local',
    runAttempt: '1',
    all,
    shards: [{ id: '1/1', paths: all }],
  }
  const attempts = all.map((path, i) => {
    const id = `attempt-${i}`,
      absolutePath = `/runner-${i}/apps/api/${path}`,
      pid = 100 + i
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
        { event: 'run-start', attempt: id, pid },
        { event: 'suite-start', attempt: id, pid, path: absolutePath },
        {
          event: 'suite-end',
          attempt: id,
          pid,
          path: absolutePath,
          runtimeError: false,
          failure: false,
          assertions: [{ status: 'passed', invocations: 1, retryReasons: [] }],
        },
        { event: 'terminal', attempt: id, pid, success: true },
      ],
    }
  })
  return { plan, report: { ...plan, shard: '1/1', paths: all, attempts, success: true } }
}
test('F3 assignments bind actual paths across distinct workspace roots; substitution cannot pass', () => {
  const { plan, report } = evidence()
  validateReports(plan, [report])
  const nested = evidence()
  const path = 'test/nested/apps/api/subcase.e2e-spec.ts'
  nested.plan.all[1] = path
  nested.report.attempts[1].path = path
  nested.report.attempts[1].absolutePath = `/other/workspace/apps/api/${path}`
  for (const row of nested.report.attempts[1].rows)
    if (row.path) row.path = nested.report.attempts[1].absolutePath
  validateReports(nested.plan, [nested.report])
  const substituted = structuredClone(report)
  const copy = structuredClone(substituted.attempts[0])
  copy.path = plan.all[1]
  copy.id = 'unique-ledger-id'
  for (const row of copy.rows) row.attempt = copy.id
  substituted.attempts[1] = copy
  assert.throws(() => validateReports(plan, [substituted]), /actual suite/)
  const alias = structuredClone(report)
  alias.attempts[1].absolutePath = '/other/apps/api/test/../test/second.e2e-spec.ts'
  assert.throws(() => validateReports(plan, [alias]), /actual suite/)
})
