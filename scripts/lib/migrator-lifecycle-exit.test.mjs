import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { watchExit, naturalExit } from '../migrator-lifecycle/exit.mjs'
import { activeSql } from '../migrator-lifecycle/process.mjs'

test('query text alone cannot establish active sleep; wait event and safe PID are observed', async () => {
  let queries = 0
  const sleeper = { pid: 123, state: 'active', wait_event_type: 'Timeout', wait_event: 'PgSleep' }
  const f = {
    observer: {
      query: async (sql, parameters) => {
        assert.deepEqual(parameters, ['statement_term'])
        assert.match(sql, /wait_event_type='Timeout' AND wait_event='PgSleep'/)
        assert.doesNotMatch(sql, /query LIKE/)
        queries++
        return { rows: queries === 1 ? [] : [sleeper] }
      },
    },
  }
  const actual = await activeSql(f, 'statement_term', {
    started: performance.now(),
    child: { exitCode: null },
  })
  assert.equal(queries, 2)
  assert.deepEqual(actual, sleeper)
  assert.equal(Object.hasOwn(actual, 'query'), false)
})

test('exit starts exactly one 200ms wait without waiting for close or signal completion', async () => {
  const child = new EventEmitter()
  let clock = 10,
    releaseDelay,
    observed = false,
    requested
  const waits = []
  const attempt = watchExit(
    child,
    0,
    async () => {
      observed = true
      requested = clock
      return { sessions: 0, locks: 0 }
    },
    {
      now: () => clock,
      wait: (ms) => {
        waits.push(ms)
        return new Promise((resolve) => {
          releaseDelay = resolve
        })
      },
    }
  )
  child.emit('exit', 143, null)
  assert.deepEqual(waits, [200])
  assert.equal((await attempt.exited).elapsed, 10)
  assert.equal(observed, false)
  clock = 212 // Simulate 2ms scheduler delay, never a second sleep.
  releaseDelay()
  const observation = await attempt.observed
  assert.equal(requested, 212)
  assert.equal(observation.observationDelayMs, 202)
  assert.equal(observation.schedulerDelayMs, 2)
  assert.equal(observed, true)
  clock = 1000
  child.emit('close', 143, null) // Delayed stream close does not move observation.
  await attempt.closed
  assert.equal(observation.observationDelayMs, 202)
})

test('observation failure is retained without an unhandled rejection', async () => {
  const child = new EventEmitter()
  const error = new Error('controlled observer failure')
  const attempt = watchExit(
    child,
    0,
    async () => {
      throw error
    },
    { now: () => 1, wait: async () => {} }
  )
  child.emit('exit', 143, null)
  await attempt.exited
  assert.equal((await attempt.observed).error, error)
})

test('spawn failure remains the original error and does not require a container', async () => {
  const child = new EventEmitter()
  const error = Object.assign(new Error('controlled spawn failure'), { code: 'ENOENT' })
  const attempt = watchExit(child, performance.now(), () =>
    assert.fail('No database observation without exit')
  )
  child.emit('error', error)
  child.emit('close', -2, null)
  await assert.rejects(naturalExit(attempt), (actual) => actual === error)
})

test('natural exit budget cannot restart after original attach deadline', async () => {
  await assert.rejects(
    naturalExit({ started: performance.now() - 45001, exited: new Promise(() => {}) }),
    { code: 'EXIT_TIMEOUT' }
  )
})
