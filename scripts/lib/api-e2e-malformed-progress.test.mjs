import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { clearTimeout } from 'node:timers'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRows, supervise } from '../api-e2e/process.mjs'

test('F2 malformed progress cannot disable KILL watchdog or turn late exit0 green', async (t) => {
  const clock = supervisorClock(t)
  for (const progress of [
    '{broken',
    'null',
    '42',
    'true',
    '"text"',
    '[]',
    '{}',
    '{"event":null}',
    '{"event":[]}',
    '{"event":"unknown"}',
  ]) {
    for (const term of ['()=>{}', '()=>process.exit(0)']) {
      const directory = mkdtempSync(join(tmpdir(), 'api-e2e-malformed-'))
      let pid,
        safetyUsed = false
      const safety = setTimeout(() => {
        safetyUsed = true
        try {
          if (pid) process.kill(-pid, 'SIGKILL')
        } catch {
          /* Owned group already exited. */
        }
      }, 1000)
      const began = clock.realNow()
      const release = join(directory, 'release')
      const running = supervise(
        process.execPath,
        [
          '-e',
          `const fs=require('node:fs');process.on('SIGTERM',${term});fs.writeFileSync(process.env.PROGRESS,${JSON.stringify(progress)}+String.fromCharCode(10));const gate=new Int32Array(new SharedArrayBuffer(4));while(!fs.existsSync(process.env.RELEASE))Atomics.wait(gate,0,0,5);setInterval(()=>{},100)`,
        ],
        {
          cwd: directory,
          progress: join(directory, 'progress.jsonl'),
          env: { ...process.env, PROGRESS: join(directory, 'progress.jsonl'), RELEASE: release },
          wallMilliseconds: 200,
          termMilliseconds: 30,
          killMilliseconds: 20,
          pollMilliseconds: 10,
          onState: (state) => {
            pid = state.pid
            if (state.forced) assert.equal(state.lifecycleFailure, true)
          },
        }
      ).then(
        (result) => ({ result }),
        (error) => ({ error })
      )
      try {
        await waitForProgress(
          join(directory, 'progress.jsonl'),
          progress + '\n',
          began + 800,
          clock.realNow
        )
        clock.tick(10)
        assert.deepEqual(clock.signals(pid), ['SIGTERM'])
        clock.tick(30)
        assert.deepEqual(
          clock.signals(pid),
          ['SIGTERM'],
          'KILL must not precede its grace boundary'
        )
        if (term.includes('exit(0)')) writeFileSync(release, '')
        else {
          clock.tick(10)
          assert.deepEqual(clock.signals(pid), ['SIGTERM', 'SIGKILL'])
        }
        const { result, error } = await running
        if (error) throw error
        assert.equal(safetyUsed, false)
        assert.ok(clock.realNow() - began < 800)
        assert.equal(result.closed, true)
        assert.equal(result.forced, true)
        assert.equal(result.lifecycleFailure, true)
        assert.ok(result.diagnostic)
        assert.throws(() => process.kill(-pid, 0), { code: 'ESRCH' })
        assert.equal(result.exit, term.includes('exit(0)') ? 0 : null)
        assert.equal(result.signal, term.includes('exit(0)') ? null : 'SIGKILL')
      } finally {
        clearTimeout(safety)
        try {
          if (pid) process.kill(-pid, 'SIGKILL')
        } catch {
          /* Owned group already exited. */
        }
        await running
        rmSync(directory, { recursive: true, force: true })
      }
    }
  }
})

test('F2 valid progress events and incomplete live tail remain readable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'api-e2e-valid-progress-'))
  try {
    const path = join(directory, 'progress.jsonl')
    const events = [
      'run-start',
      'suite-start',
      'suite-end',
      'terminal',
      'cleanup-start',
      'cleanup-phase',
      'cleanup-failure',
      'cleanup-failed',
      'cleanup-end',
    ]
    const rows = events.map((event) => ({ event }))
    writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n{partial')
    assert.deepEqual(readRows(path, true), rows)
    assert.throws(() => readRows(path), /Truncated/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

// Only the supervisor's clock is virtual. Child startup, signal delivery and reaping stay real.
function supervisorClock(t) {
  const realNow = performance.now.bind(performance)
  let now = 1
  t.mock.method(performance, 'now', () => now)
  t.mock.timers.enable({ apis: ['setInterval'] })
  const kill = t.mock.method(process, 'kill')
  return {
    realNow,
    tick(milliseconds) {
      now += milliseconds
      t.mock.timers.tick(milliseconds)
    },
    signals(pid) {
      return kill.mock.calls
        .filter(({ arguments: args }) => args[0] === -pid && typeof args[1] === 'string')
        .map(({ arguments: args }) => args[1])
    },
  }
}

async function waitForProgress(path, expected, deadline, realNow) {
  while (realNow() < deadline) {
    if (existsSync(path) && readFileSync(path, 'utf8') === expected) return
    await delay(5)
  }
  throw new Error('Child did not publish progress after installing its SIGTERM handler')
}
