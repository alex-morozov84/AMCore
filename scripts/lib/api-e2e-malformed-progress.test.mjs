import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { supervise } from '../api-e2e/process.mjs'

test('F2 malformed progress cannot disable KILL watchdog or turn late exit0 green', async () => {
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
          `process.on('SIGTERM',${term});require('node:fs').writeFileSync(process.env.PROGRESS,'{broken'+String.fromCharCode(10));setInterval(()=>{},100)`,
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
          },
        }
      )
      assert.equal(safetyUsed, false)
      assert.ok(performance.now() - began < 800)
      assert.equal(result.closed, true)
      assert.equal(result.forced, true)
      assert.equal(result.lifecycleFailure, true)
      assert.ok(result.diagnostic)
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
})
