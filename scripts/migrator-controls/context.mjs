import assert from 'node:assert/strict'
import { isAbsolute } from 'node:path'
export function journal(suffix) {
  const path = process.env.AMCORE_MIGRATOR_LIFECYCLE_JOURNAL
  assert.ok(
    path && isAbsolute(path),
    'Controls require an absolute AMCORE_MIGRATOR_LIFECYCLE_JOURNAL'
  )
  return suffix ? `${path}.${suffix}` : path
}
