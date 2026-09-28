import { spawnSync } from 'node:child_process'
import { assertGenerationAbsent } from './process-identity.mjs'
import { recordRetirement } from './retirement-audit.mjs'

export function processTable() {
  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid=,uid=,lstart=,command='], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, LC_ALL: 'C' },
    maxBuffer: 8 * 1024 * 1024,
  })
  if (result.error || result.status !== 0)
    throw new Error(
      `Process ownership inventory unavailable: ${result.error?.message ?? result.stderr}`
    )
  const rows = result.stdout.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/)
    return match
      ? [
          {
            pid: Number(match[1]),
            parent: Number(match[2]),
            pgid: Number(match[3]),
            uid: Number(match[4]),
            started: match[5],
            command: match[6],
          },
        ]
      : []
  })
  if (!rows.some((row) => row.pid === process.pid))
    throw new Error('Process inventory format incomplete; removal refused')
  return rows
}

export function observeGroup(child, rows = processTable()) {
  if (child.standGroupAbsent) return false
  const members = rows.filter((row) => row.pgid === child.pid)
  if (!members.length) {
    assertGenerationAbsent(
      { ...child, started: child.started ?? child.standStarted ?? 'tracked' },
      rows
    )
    child.standGroupAbsent = true
    recordRetirement(child)
    return false
  }
  const proved = child.standMembers?.some((known) =>
    members.some((row) => row.pid === known.pid && row.started === known.started)
  )
  if (!proved) throw new Error('Owned process group identity unproved or reused; retain recovery')
  child.standMembers = members.map(({ pid, started }) => ({ pid, started }))
  return true
}

export function assertGroupsAbsent(recorded, rows = processTable()) {
  for (const child of recorded.flatMap((entry) => [entry, ...(entry.groups ?? [])]))
    assertGenerationAbsent(child, rows)
}

export function observeTree(child, rows = processTable()) {
  child.standDetached ??= []
  const groups = [...(child.standGroupAbsent ? [] : [child]), ...child.standDetached]
  const owned = new Set(
    groups.flatMap((group) =>
      (group.standMembers ?? []).flatMap((known) =>
        rows.some((row) => row.pid === known.pid && row.started === known.started)
          ? [known.pid]
          : []
      )
    )
  )
  let size
  do {
    size = owned.size
    for (const row of rows) if (owned.has(row.parent)) owned.add(row.pid)
  } while (owned.size !== size)
  for (const row of rows) {
    if (!owned.has(row.pid) || groups.some((group) => group.pid === row.pgid)) continue
    if (
      !owned.has(row.pgid) ||
      !rows.some((leader) => leader.pid === row.pgid && leader.pgid === row.pgid)
    )
      throw new Error('Descendant joined an unproved process group; retain recovery')
    const group = {
      pid: row.pgid,
      started: rows.find((leader) => leader.pid === row.pgid).started,
      leaderBirth: rows.find((leader) => leader.pid === row.pgid).started,
      standMembers: [{ pid: row.pid, started: row.started }],
    }
    child.standDetached.push(group)
    groups.push(group)
  }
  let alive = false
  for (const group of groups) {
    if (observeGroup(group, rows)) alive = true
  }
  child.standDetached = child.standDetached.filter((group) => !group.standGroupAbsent)
  return alive
}
