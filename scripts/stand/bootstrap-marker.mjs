import { readFile } from 'node:fs/promises'
import { dataAdmission } from './ownership.mjs'
import { localSql } from './local-sql.mjs'

export async function initializeMarker(m) {
  const held = JSON.parse(
    await readFile(`${m.worktree}/.amcore/stands/${m.id}/lease/owner.json`, 'utf8')
  )
  if (held.pid !== process.pid || held.worktree !== m.worktree)
    throw new Error('Bootstrap requires its own active lease')
  await dataAdmission(m, true)
  const existing = await localSql(
    m,
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'stand_meta' AND table_name = 'identity';"
  )
  if (existing.trim() === '0') {
    if (m.markerInitialized) throw new Error('Initialized DB marker missing; writes refused')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(m.uuid))
      throw new Error('Invalid marker identity')
    await localSql(
      m,
      `CREATE SCHEMA stand_meta; CREATE TABLE stand_meta.identity (uuid text PRIMARY KEY); INSERT INTO stand_meta.identity VALUES ('${m.uuid}');`
    )
  }
  await dataAdmission(m)
}
