import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { root, directory, lease, save, load } from './state.mjs'
import { processTable } from './process-groups.mjs'
import { closeoutStand } from './closeout.mjs'

test('unobserved reparented short-title detached child blocks closeout by kernel cwd without being signalled', async () => {
  const id = `escaped-${randomUUID()}`,
    attempt = randomUUID()
  const held = await lease(id, 'proof')
  const m = {
    version: 1,
    id,
    uuid: randomUUID(),
    attempt,
    worktree: root,
    purpose: 'e2e',
    topology: 'path',
    mocked: true,
    state: 'allocated',
    snapshot: `${directory(id)}/source-${attempt}`,
  }
  await mkdir(m.snapshot)
  await save(m)
  // Deliberately absent from the controller journal: model a fork between observations.
  const body = `process.title='t016-escaped-worker'; require('node:fs').writeFileSync('ready',String(process.pid)); setInterval(()=>{},1000)`
  const leader = spawn(
    process.execPath,
    [
      '-e',
      `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(body)}],{detached:true,stdio:'ignore'}); c.unref()`,
    ],
    { cwd: m.snapshot, stdio: 'ignore' }
  )
  await once(leader, 'close')
  let worker, proved
  try {
    for (let n = 0; n < 100; n++) {
      worker = Number(await readFile(`${m.snapshot}/ready`, 'utf8').catch(() => '0'))
      if (worker) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    proved = processTable().find((row) => row.pid === worker)
    assert.ok(proved)
    await assert.rejects(() => closeoutStand(m), /cwd proof/)
    const retained = await load(id)
    assert.equal(retained.closeout.incomplete, true)
    assert.ok(retained.suspectedProcesses.some((row) => row.pid === worker))
    process.kill(worker, 0)
  } finally {
    const current = processTable().find((row) => row.pid === worker)
    if (current) {
      assert.equal(current.started, proved.started)
      assert.equal(current.pgid, worker)
      process.kill(worker, 'SIGTERM')
      for (let n = 0; n < 100 && processTable().some((row) => row.pid === worker); n++)
        await new Promise((resolve) => setTimeout(resolve, 30))
    }
    await closeoutStand(m)
    await held.release()
    await rm(directory(id), { recursive: true })
  }
})
