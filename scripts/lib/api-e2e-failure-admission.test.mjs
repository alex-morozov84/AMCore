import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exerciseRun } from './api-e2e-run-test-support.mjs'
import { cleanupE2E } from '../../apps/api/test/e2e-cleanup.ts'
import { closeOwnedQueueGraph } from '../../apps/api/test/queue-graph-cleanup.ts'

test('F4 custom rejected/hanging module close still stops Redis and retains cleanup failure', async () => {
  for (const mode of ['reject', 'hang']) {
    const order = []
    await assert.rejects(
      closeOwnedQueueGraph(
        {
          module: {
            close: async () => {
              order.push('module')
              if (mode === 'reject') throw new Error('module close rejected')
              await new Promise(() => {})
            },
          },
          redis: {
            stop: async () => {
              order.push('redis')
            },
          },
        },
        cleanupE2E,
        10
      ),
      AggregateError
    )
    assert.deepEqual(order, ['module', 'redis'])
  }
})
test('F4 parent retains first execution diagnostic and records later cleanup error; no next child', async () => {
  const { spawned, report } = await exerciseRun(undefined, {
    executionError: 'first execution fault',
    cleanupError: 'later inspection fault',
  })
  assert.equal(spawned.length, 1)
  assert.equal(report.success, false)
  assert.equal(report.attempts[0].diagnostic, 'first execution fault')
  assert.ok(
    report.attempts[0].diagnostics.some((item) => item.message === 'later inspection fault')
  )
})
test('F5 only complete ordinary failure permits next child; incomplete metadata never does', async () => {
  const complete = await exerciseRun()
  assert.equal(complete.spawned.length, 2)
  assert.equal(complete.report.success, false)
  assert.equal(complete.report.attempts[0].lifecycleFailure, false)
  for (const change of [
    (data) => {
      data.rows.pop()
    },
    (data) => {
      data.rows[2].attempt = 'wrong'
    },
    (data) => {
      delete data.rows[2].assertions[0].retryReasons
    },
    (data) => {
      data.rows.push(data.rows[2])
    },
    (data) => {
      data.rows[2].assertions[0].status = 'pending'
    },
    (data) => {
      data.result.forced = true
      data.result.exit = 0
    },
    (data) => {
      data.rows.push({ event: 'cleanup-failure', attempt: data.rows[0].attempt })
    },
  ]) {
    const { spawned, report } = await exerciseRun(change)
    assert.equal(spawned.length, 1)
    assert.equal(report.success, false)
    assert.equal(report.attempts[0].lifecycleFailure, true)
  }
})
