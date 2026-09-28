// Birth identities distinguish an extinct owned generation from foreign numeric reuse.
export function assertGenerationAbsent(entry, rows) {
  if (!Number.isInteger(entry.pid) || entry.pid <= 1 || !entry.started)
    throw new Error('Incomplete child recovery identity')
  const known = entry.members ?? entry.standMembers ?? []
  if (
    !Array.isArray(known) ||
    known.some((r) => !Number.isInteger(r.pid) || r.pid <= 1 || !r.started)
  )
    throw new Error('Incomplete member recovery identity')
  if (
    known.some((member) => rows.some((r) => r.pid === member.pid && r.started === member.started))
  )
    throw new Error('Recorded child/process group alive; recovery/removal refused')
  const members = rows.filter((r) => r.pgid === entry.pid)
  const birth = entry.leaderBirth ?? known.find((r) => r.pid === entry.pid)?.started
  const occupant = rows.find((r) => r.pid === entry.pid)
  if (!members.length && (!occupant || (birth && occupant.started !== birth))) return
  // A newly born leader with this PGID cannot coexist with the old group generation.
  if (birth && members.some((r) => r.pid === entry.pid && r.started !== birth)) return
  throw new Error(
    'Recorded child/process group alive or reused without birth proof; recovery/removal refused'
  )
}

export function assertSupervisorAbsent(owner, rows) {
  const occupant = rows.find((r) => r.pid === owner.pid)
  if (!occupant) return
  if (owner.birth && occupant.started !== owner.birth) return
  // Legacy leases have an acquisition timestamp, not a process birth identity.
  throw new Error('Recorded supervisor alive or PID reused without birth proof; recovery refused')
}
