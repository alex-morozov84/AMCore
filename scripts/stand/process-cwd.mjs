import { readlinkSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

export function sourceSurvivors(m, rows, excluded) {
  const roots = [m.snapshot, `${m.worktree}/.amcore/stands/${m.id}`]
  if (typeof m.fixture === 'string') roots.push(m.fixture)
  for (const root of [...roots]) {
    try {
      roots.push(realpathSync(root))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  const paths = process.platform === 'linux' ? linuxCwds(rows) : macCwds()
  return rows
    .filter((row) => !excluded.has(row.pid))
    .flatMap((row) => {
      const cwd = paths.get(row.pid)?.replace(/ \(deleted\)$/, '')
      return cwd && roots.some((root) => cwd === root || cwd.startsWith(`${root}/`))
        ? [{ pid: row.pid, pgid: row.pgid, started: row.started, cwd }]
        : []
    })
}

function linuxCwds(rows) {
  const paths = new Map()
  for (const row of rows.filter((entry) => entry.uid === process.getuid())) {
    try {
      paths.set(row.pid, readlinkSync(`/proc/${row.pid}/cwd`))
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error
    }
  }
  return paths
}

function macCwds() {
  if (process.platform !== 'darwin') throw new Error('Unsupported process cwd inventory platform')
  const result = spawnSync(
    'lsof',
    ['-a', '-u', String(process.getuid()), '-d', 'cwd', '-F', 'pn'],
    {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, LC_ALL: 'C' },
      maxBuffer: 8 * 1024 * 1024,
    }
  )
  if (result.error || result.status !== 0 || result.stderr.trim())
    throw new Error('Process cwd inventory unavailable; resource removal refused')
  const paths = new Map()
  let pid
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    if (line.startsWith('n') && pid) paths.set(pid, line.slice(1))
  }
  if (!paths.has(process.pid)) throw new Error('Incomplete process cwd inventory')
  return paths
}
