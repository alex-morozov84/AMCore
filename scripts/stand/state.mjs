import { lstat, mkdir, readFile, rename, writeFile, rm, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { processTable } from './process-groups.mjs'

export const root = resolve(import.meta.dirname, '../..')
export const stateRoot = join(root, '.amcore/stands')
export const validId = (id) => /^[a-z0-9-]{1,80}$/.test(id)
export function directory(id) {
  if (!validId(id)) throw new Error('Invalid stand ID')
  return join(stateRoot, id)
}
async function safeDirectory(worktree, id, create = false) {
  if (!validId(id)) throw new Error('Invalid stand ID')
  let path = worktree
  for (const component of ['.amcore', 'stands', id]) {
    path = join(path, component)
    if (create) {
      await mkdir(path, { mode: 0o700 }).catch((error) => {
        if (error.code !== 'EEXIST') throw error
      })
    }
    const item = await lstat(path)
    if (item.isSymbolicLink() || !item.isDirectory())
      throw new Error('Unsafe stand state path refused')
  }
  return path
}
export async function save(manifest) {
  if (!validId(manifest.id)) throw new Error('Invalid stand ID')
  const dir = await safeDirectory(
    root === manifest.snapshot ? manifest.worktree : root,
    manifest.id,
    true
  )
  if ((await lstat(dir)).isSymbolicLink()) throw new Error('Symlink state directory refused')
  const tmp = join(dir, `manifest.${randomUUID()}.tmp`)
  await writeFile(tmp, JSON.stringify(manifest, null, 2), { mode: 0o600 })
  await rename(tmp, join(dir, 'manifest.json'))
}
export async function load(id, orphan = false) {
  const dir = await safeDirectory(root, id)
  if ((await lstat(dir)).isSymbolicLink()) throw new Error('Symlink state directory refused')
  if ((await lstat(join(dir, 'manifest.json'))).isSymbolicLink())
    throw new Error('Symlink manifest refused')
  const m = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
  if (m.version !== 1 || m.id !== id || (!orphan && m.worktree !== root))
    throw new Error('Foreign/incompatible manifest')
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  if (
    !uuid.test(m.uuid) ||
    !uuid.test(m.attempt) ||
    !['preview', 'e2e'].includes(m.purpose) ||
    !['path', 'host'].includes(m.topology) ||
    !m.snapshot.startsWith(`${m.worktree}/.amcore/stands/${id}/source-`)
  )
    throw new Error('Invalid manifest identity')
  if (orphan) {
    if (m.runToken)
      throw new Error('Orphan has unfinished run; restore its recovery record and inspect children')
    const present = await access(m.worktree).then(
      () => true,
      () => false
    )
    if (present)
      throw new Error(
        'Orphan removal requires a missing original worktree; live foreign checkout refused'
      )
  }
  return m
}
export async function lease(id, operation) {
  await safeDirectory(root, id, true)
  if (operation !== 'recovery') {
    const recovering = await lstat(join(directory(id), 'recovery')).then(
      () => true,
      (e) => {
        if (e.code !== 'ENOENT') throw e
        return false
      }
    )
    if (recovering) throw new Error('Stand recovery in progress; mutation refused')
  }
  const birth = processTable().find((row) => row.pid === process.pid).started
  const lock = join(directory(id), 'lease')
  try {
    await mkdir(lock, { mode: 0o700 })
  } catch {
    throw new Error(`Stand ${id} busy or interrupted; inspect status and recover explicitly`)
  }
  const token = randomUUID()
  await writeFile(
    join(lock, 'owner.json'),
    JSON.stringify({
      pid: process.pid,
      birth,
      token,
      operation,
      started: new Date().toISOString(),
      worktree: root,
    }),
    { mode: 0o600 }
  )
  await writeFile(join(lock, 'children.json'), '[]', { mode: 0o600 })
  return { token, release: () => rm(lock, { recursive: true }) }
}
