import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRows, supervise } from '../api-e2e/process.mjs'

test('F2 malformed progress cannot disable KILL watchdog or turn late exit0 green', async () => {
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
        } catch {}
      }, 1000)
      const began = performance.now()
      try {
        const result = await supervise(
          process.execPath,
          [
            '-e',
            `process.on('SIGTERM',${term});require('node:fs').writeFileSync(process.env.PROGRESS,${JSON.stringify(progress)}+String.fromCharCode(10));setInterval(()=>{},100)`,
          ],
          {
            cwd: directory,
            progress: join(directory, 'progress.jsonl'),
            env: { ...process.env, PROGRESS: join(directory, 'progress.jsonl') },
            wallMilliseconds: 200,
            termMilliseconds: 30,
            killMilliseconds: 20,
            pollMilliseconds: 10,
            onState: (state) => {
              pid = state.pid
              if (state.forced) assert.equal(state.lifecycleFailure, true)
            },
          }
        )
        assert.equal(safetyUsed, false)
        assert.ok(performance.now() - began < 800)
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
        } catch {}
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
