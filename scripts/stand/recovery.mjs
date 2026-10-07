import { readFile, lstat, rm, mkdir, writeFile } from 'node:fs/promises'
import { assertNoSurvivors } from './survivors.mjs'
import { directory, load, lease, save } from './state.mjs'
import { cleanup } from './ownership.mjs'
import { assertGroupsAbsent, processTable } from './process-groups.mjs'
import { assertSupervisorAbsent } from './process-identity.mjs'
import { disposeControlSocket } from './control-socket.mjs'
import { verifyRunnerRemoval } from './wrapper-removal.mjs'

export async function recover(id, purge, options = {}) {
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
    await inspectAndRecover(m, id, purge, options)
  } finally {
    await rm(guard, { recursive: true })
  }
}

async function inspectAndRecover(m, id, purge, options) {
  const path = `${directory(id)}/lease`
  if ((await lstat(path)).isSymbolicLink()) throw new Error('Symlink recovery refused')
  const owner = JSON.parse(await readFile(`${path}/owner.json`, 'utf8'))
  if (!Number.isInteger(owner.pid) || !owner.token || owner.worktree !== m.worktree)
    throw new Error('Incomplete recovery identity')
  assertSupervisorAbsent(owner, processTable())
  const recorded = JSON.parse(await readFile(`${path}/children.json`, 'utf8'))
  assertGroupsAbsent(recorded)
  await assertNoSurvivors(m)
  await verifyRunnerRemoval(m)
  await disposeControlSocket(m.controlSocket)
  await preserveRecovery(path, m)
  await rm(path, { recursive: true })
  const held = await lease(id, 'recovery')
  try {
    if (m.mocked) {
      delete m.runToken
      delete m.relay
      m.state = purge ? 'purged' : 'stopped'
      await save(m)
    } else await cleanup(m, purge, options)
  } finally {
    await held.release()
  }
}

async function preserveRecovery(path, m) {
  const archive = `${directory(m.id)}/recovery-history/${Date.now()}`
  await mkdir(archive, { recursive: true, mode: 0o700 })
  for (const name of ['owner.json', 'children.json', 'children.json.retired.json']) {
    const content = await readFile(`${path}/${name}`).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
    if (content) await writeFile(`${archive}/${name}`, content, { mode: 0o600, flag: 'wx' })
  }
}
