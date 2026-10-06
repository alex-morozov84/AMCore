import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, rm } from 'node:fs/promises'
import { test } from 'node:test'
import { root, directory, lease, save } from './state.mjs'
import { waitForRunnerCloseout } from './wait-closeout.mjs'

for (const completes of [true, false])
  test(`mocked closeout observes natural child exit or preserves timed-out recovery: completes=${completes}`, async () => {
    const id = `closeout-proof-${randomUUID()}`
    const attempt = randomUUID()
    const manifest = {
      version: 1, id, uuid: randomUUID(), attempt, worktree: root,
      purpose: 'e2e', topology: 'path', mocked: true, state: 'allocated',
      snapshot: `${directory(id)}/source-${attempt}`,
    }
    await mkdir(manifest.snapshot, { recursive: true })
    const held = await lease(id, 'closeout-proof')
    await save(manifest)
    const child = spawn(process.execPath, ['-e', completes
      ? 'setTimeout(() => process.exit(0), 800)'
      : 'setInterval(() => {}, 1000)'], {
      cwd: manifest.snapshot, detached: true, stdio: 'ignore',
    })
    const closed = once(child, 'close')
    await once(child, 'spawn')
    try {
      if (completes) {
        await waitForRunnerCloseout(manifest, 5_000)
        assert.deepEqual(await closed, [0, null], 'child must finish naturally, not be killed')
        assert.equal(manifest.state, 'purged')
        assert.ok(manifest.closeout.verifiedAt)
        assert.equal(manifest.closeout.incomplete, undefined)
      } else {
        await assert.rejects(() => waitForRunnerCloseout(manifest, 100), /surviving owned child/)
        process.kill(child.pid, 0)
        assert.equal(manifest.state, 'allocated')
        assert.equal(manifest.closeout.incomplete, true)
      }
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
      await closed
      await held.release()
      await rm(directory(id), { recursive: true })
    }
  })
