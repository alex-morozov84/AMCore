import { createHash } from 'node:crypto'
import { writeFileSync, renameSync } from 'node:fs'
let path, audit
export function setRetirementJournal(journal) {
  path = journal && `${journal}.retired.json`
  audit = { count: 0, digest: '', lastAbsentAt: null }
}
export function recordRetirement(group) {
  if (!path) return
  audit.count++
  audit.lastAbsentAt = new Date().toISOString()
  audit.digest = createHash('sha256')
    .update(audit.digest)
    .update(JSON.stringify({ pid: group.pid, members: group.standMembers, at: audit.lastAbsentAt }))
    .digest('hex')
  writeFileSync(`${path}.tmp`, JSON.stringify(audit), { mode: 0o600 })
  renameSync(`${path}.tmp`, path)
}
