import { readFile, lstat } from 'node:fs/promises'
import { children } from './process.mjs'
import { processTable, assertGroupsAbsent } from './process-groups.mjs'
import { sourceSurvivors } from './process-cwd.mjs'

export async function assertNoSurvivors(m) {
  const rows = processTable()
  const path = `${m.worktree}/.amcore/stands/${m.id}/lease/children.json`
  const recorded = await lstat(path).then(
    async (entry) => {
      if (entry.isSymbolicLink()) throw new Error('Symlink child journal refused')
      return JSON.parse(await readFile(path, 'utf8'))
    },
    (error) => {
      if (error.code !== 'ENOENT') throw error
      return []
    }
  )
  for (const child of children)
    if (
      child.standCwd === m.snapshot ||
      child.standCwd?.startsWith(`${m.worktree}/.amcore/stands/${m.id}/`)
    )
      recorded.push({
        pid: child.pid,
        started: child.standStarted,
        groups: child.standDetached?.map((group) => ({ pid: group.pid, started: group.started })),
      })
  try {
    assertGroupsAbsent(recorded, rows)
  } catch (error) {
    throw new Error(`Possible surviving owned child: ${error.message}`)
  }
  const ancestors = new Set()
  let pid = process.pid
  while (pid && !ancestors.has(pid)) {
    ancestors.add(pid)
    pid = rows.find((row) => row.pid === pid)?.parent
  }
  const sourceProcesses = sourceSurvivors(m, rows, ancestors)
  if (sourceProcesses.length) {
    m.suspectedProcesses = sourceProcesses
    throw new Error(
      `Possible surviving owned child (cwd proof): ${JSON.stringify(sourceProcesses)}`
    )
  }
  delete m.suspectedProcesses
  if (
    rows.some(
      (row) =>
        !ancestors.has(row.pid) &&
        (row.command.includes(m.snapshot) ||
          row.command.includes(`${m.worktree}/.amcore/stands/${m.id}/`))
    )
  )
    throw new Error('Possible surviving owned child; resource removal refused')
}
