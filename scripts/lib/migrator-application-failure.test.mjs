import assert from 'node:assert/strict'
import { test } from 'node:test'
import childProcess from 'node:child_process'
import timers from 'node:timers'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { syncBuiltinESMExports } from 'node:module'
import { command } from '../migrator-application/client.mjs'
import { safeError } from '../migrator-lifecycle/safety.mjs'

const secret = 'postgresql://fixture:fixture-only-secret-never-real@fixture.invalid'

function fixture(t, journal, immediateTimeouts = true) {
  const events = [],
    durations = []
  const child = Object.assign(new EventEmitter(), {
    pid: 123,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: (signal) => events.push({ signal }),
  })
  const f = {
    run: 'fixture-run',
    endpoint: 'unix:///fixture',
    clients: [],
    journal: () => journal(child),
  }
  t.mock.method(childProcess, 'spawn', () => {
    globalThis.queueMicrotask(() => child.stdout.write(secret))
    return child
  })
  t.mock.method(console, 'error', (line) => events.push(JSON.parse(line)))
  if (immediateTimeouts)
    t.mock.method(timers, 'setTimeout', (callback, milliseconds) => {
      durations.push(milliseconds)
      globalThis.queueMicrotask(callback)
    })
  syncBuiltinESMExports()
  t.after(() => {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    child.stdout.destroy()
    child.stderr.destroy()
  })
  return { f, events, durations }
}

for (const cause of ['timeout', 'journal']) {
  test(`${cause} failure is recorded before diagnostic kill and survives failed close`, async (t) => {
    const primary = Object.assign(new Error(secret), { code: 'EIO' })
    const { f, events, durations } = fixture(t, () => {
      if (cause === 'journal') throw primary
    })
    await assert.rejects(command(f, 'fixture-client', ['run', secret]), (error) => {
      assert.ok(error instanceof AggregateError)
      assert.equal(error.errors.length, 2)
      if (cause === 'journal') assert.equal(error.errors[0], primary)
      assert.equal(
        error.errors[0].code,
        cause === 'timeout' ? 'APPLICATION_COMMAND_TIMEOUT' : 'EIO'
      )
      assert.ok(error.errors[1] instanceof AggregateError)
      assert.deepEqual(
        error.errors[1].errors.map((e) => e.code),
        ['ATTACH_CLOSE_TIMEOUT', 'ATTACH_KILL_TIMEOUT']
      )
      assert.equal(JSON.stringify(safeError(error)).includes(secret), false)
      return true
    })
    assert.deepEqual(durations, cause === 'timeout' ? [120000, 5000, 2000] : [5000, 2000])
    assert.deepEqual(
      events.map((e) => e.verdict ?? e.signal),
      ['FAIL', 'CLEANUP_ERROR', 'SIGKILL']
    )
    assert.equal(events[0].phase, 'application-command')
    assert.equal(events[0].error.code, cause === 'timeout' ? 'APPLICATION_COMMAND_TIMEOUT' : 'EIO')
    assert.equal(events[1].error.code, 'ATTACH_CLOSE_TIMEOUT')
    assert.equal(JSON.stringify(events).includes(secret), false)
  })
}

test('successful diagnostic close preserves the original journal error', async (t) => {
  const primary = Object.assign(new Error(secret), { code: 'EIO' })
  const { f, events } = fixture(
    t,
    (child) => {
      child.emit('close', 0, null)
      throw primary
    },
    false
  )
  await assert.rejects(command(f, 'fixture-client', ['run', secret]), (error) => error === primary)
  assert.deepEqual(
    events.map((e) => e.verdict),
    ['FAIL']
  )
  assert.equal(f.clients[0].closed, true)
  assert.equal(JSON.stringify(events).includes(secret), false)
})
