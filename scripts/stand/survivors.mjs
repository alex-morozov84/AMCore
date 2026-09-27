import { run } from './process.mjs'

export async function assertNoSurvivors(m) {
  const output = await run('ps', ['-axo', 'pid=,ppid=,pgid=,command='], { capture: true })
  const rows = output.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)
    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), command: match[4] }] : []
  })
  const ancestors = new Set()
  let pid = process.pid
  while (pid && !ancestors.has(pid)) {
    ancestors.add(pid)
    pid = rows.find((row) => row.pid === pid)?.parent
  }
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
