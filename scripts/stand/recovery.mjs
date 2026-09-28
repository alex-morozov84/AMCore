import { readFile, lstat, rm, mkdir, writeFile } from 'node:fs/promises'
import { assertNoSurvivors } from './survivors.mjs'
import { directory, load, lease, save } from './state.mjs'
import { cleanup } from './ownership.mjs'
import { assertGroupsAbsent } from './process-groups.mjs'
import { disposeControlSocket } from './control-socket.mjs'
import { verifyRunnerRemoval } from './wrapper-removal.mjs'

export async function recover(id, purge) {
  const m = await load(id)
  const guard = `${directory(id)}/recovery`
  await mkdir(guard, { mode: 0o700 }).catch(() => {
    throw new Error('Recovery already active or interrupted; inspect its owner')
  })
  await writeFile(
    `${guard}/owner.json`,
    JSON.stringify({ pid: process.pid, id, started: new Date().toISOString() }),
    { mode: 0o600 }
  )
  try {
    await inspectAndRecover(m, id, purge)
  } finally {
    await rm(guard, { recursive: true })
  }
}

async function inspectAndRecover(m, id, purge) {
  const path = `${directory(id)}/lease`
  if ((await lstat(path)).isSymbolicLink()) throw new Error('Symlink recovery refused')
  const owner = JSON.parse(await readFile(`${path}/owner.json`, 'utf8'))
  if (!Number.isInteger(owner.pid) || !owner.token || owner.worktree !== m.worktree)
    throw new Error('Incomplete recovery identity')
  try {
    process.kill(owner.pid, 0)
    throw new Error('Recorded supervisor alive or PID reused; recovery refused')
  } catch (e) {
    if (e.code !== 'ESRCH') throw e
  }
  const recorded = JSON.parse(await readFile(`${path}/children.json`, 'utf8'))
  assertGroupsAbsent(recorded)
  await assertNoSurvivors(m)
  await verifyRunnerRemoval(m)
  await disposeControlSocket(m.controlSocket)
  await rm(path, { recursive: true })
  const held = await lease(id, 'recovery')
  try {
    if (m.mocked) {
      delete m.runToken
      delete m.relay
      m.state = purge ? 'purged' : 'stopped'
      await save(m)
    } else await cleanup(m, purge)
  } finally {
    await held.release()
  }
}
