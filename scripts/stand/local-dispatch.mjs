import { lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { directory, root, stateRoot } from './state.mjs'
import { assertGroupsAbsent, processTable } from './process-groups.mjs'
import { assertSupervisorAbsent } from './process-identity.mjs'

export const localDispatchId = 'local-dispatch'
export const isProductStandId = (id) => /^local-[a-f0-9]{24}(?:-[1-9][0-9]*)?$/.test(id)

function stat(path) {
  return lstat(path).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
}

async function inspectLease(dir) {
  const lock = join(dir, 'lease')
  const state = await stat(lock)
  if (!state) return
  if (!state.isDirectory()) throw new Error('Unsafe local lease')
  const read = async (file) => {
    const path = join(lock, file)
    if (!(await lstat(path)).isFile()) throw new Error('Unsafe local lease record')
    return JSON.parse(await readFile(path, 'utf8'))
  }
  const owner = await read('owner.json')
  if (owner.worktree !== root || !Number.isInteger(owner.pid) || !owner.birth || !owner.token)
    throw new Error('Incomplete local process identity')
  const processes = processTable()
  assertSupervisorAbsent(owner, processes)
  const childMarker = `--local-dispatch-token ${owner.token}`
  const standEntrypoint = join(root, 'scripts/stand.mjs')
  if (
    processes.some(
      ({ command }) => command.includes(childMarker) || command.includes(standEntrypoint)
    )
  )
    throw new Error('A stand command is still running in this checkout. Wait and retry recovery.')
  assertGroupsAbsent(await read('children.json'), processes)
  return lock
}

async function recoverUnallocated(id) {
  const dir = directory(id)
  if (!(await lstat(dir)).isDirectory()) throw new Error('Unsafe local stand state')
  if (await stat(join(dir, 'manifest.json'))) return
  const guard = join(dir, 'recovery')
  await mkdir(guard, { mode: 0o700 })
  try {
    // Creation saves a manifest before building any Docker resources.
    if (await stat(join(dir, 'manifest.json'))) return
    const lock = await inspectLease(dir)
    if (lock) await rm(lock, { recursive: true })
  } finally {
    await rm(guard, { recursive: true })
  }
}

export async function recoverLocalDispatch() {
  const dir = directory(localDispatchId)
  for (const path of [join(root, '.amcore'), stateRoot, dir]) {
    const state = await stat(path)
    if (!state) {
      console.log('No local dispatcher to recover.')
      return
    }
    if (!state.isDirectory()) throw new Error('Unsafe local dispatcher state')
  }
  const guard = join(dir, 'recovery')
  await mkdir(guard, { mode: 0o700 })
  try {
    const lock = await inspectLease(dir)
    for (const id of (await readdir(stateRoot)).filter(isProductStandId))
      await recoverUnallocated(id)
    if (lock) await rm(lock, { recursive: true })
    console.log('Local dispatcher recovered. Stand records and datasets are preserved.')
  } finally {
    await rm(guard, { recursive: true })
  }
}
