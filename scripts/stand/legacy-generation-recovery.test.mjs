import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { directory, root, lease, save, load } from './state.mjs'
import { processTable } from './process-groups.mjs'
import { recover } from './recovery.mjs'

test('generation recovery native: retained legacy journal recovers without signalling foreign sentinel', async () => {
  const id = `legacy-generation-${randomUUID()}`,
    dir = directory(id),
    attempt = randomUUID()
  const sentinel = spawn(
    process.execPath,
    ['-e', "process.title='t016-foreign'; setInterval(()=>{},1000)"],
    { detached: true, stdio: 'ignore' }
  )
  await once(sentinel, 'spawn')
  let held
  const sentinelBirth = processTable().find((r) => r.pid === sentinel.pid)?.started
  assert.ok(sentinelBirth)
  try {
    held = await lease(id, 'legacy-fixture')
    const m = {
      version: 1,
      id,
      uuid: randomUUID(),
      attempt,
      worktree: root,
      mocked: true,
      purpose: 'e2e',
      topology: 'path',
      snapshot: `${dir}/source-${attempt}`,
      state: 'allocated',
    }
    await mkdir(m.snapshot)
    await save(m)
    const row = processTable().find((r) => r.pid === sentinel.pid)
    assert.ok(row)
    const owner = {
      pid: 2000000000,
      started: new Date().toISOString(),
      token: held.token,
      worktree: root,
    }
    await writeFile(`${dir}/lease/owner.json`, JSON.stringify(owner))
    const journal = JSON.stringify([
      {
        pid: sentinel.pid,
        started: 'old-leader',
        closed: true,
        members: [{ pid: sentinel.pid, started: 'old-leader-birth' }],
        groups: [
          {
            pid: sentinel.pid,
            started: 'old-group',
            members: [{ pid: sentinel.pid, started: 'old-group-birth' }],
          },
        ],
      },
    ])
    await writeFile(`${dir}/lease/children.json`, journal)
    await recover(id, true)
    held = undefined
    assert.equal((await load(id)).state, 'purged')
    process.kill(sentinel.pid, 0)
    assert.equal(processTable().find((r) => r.pid === sentinel.pid).started, row.started)
    const [archive] = await readdir(`${dir}/recovery-history`)
    const preserved = await readFile(`${dir}/recovery-history/${archive}/children.json`, 'utf8')
    assert.equal(
      createHash('sha256').update(preserved).digest('hex'),
      createHash('sha256').update(journal).digest('hex')
    )
  } finally {
    // Only this fixture-created sentinel is terminated after its birth is rechecked.
    const row = processTable().find((r) => r.pid === sentinel.pid)
    if (row && row.pgid === sentinel.pid && row.started === sentinelBirth) {
      sentinel.kill('SIGTERM')
      await once(sentinel, 'exit')
    }
    await held?.release()
    await rm(dir, { recursive: true })
  }
})
