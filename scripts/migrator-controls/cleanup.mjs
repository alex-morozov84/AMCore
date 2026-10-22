import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { root } from '../migrator-operations/context.mjs'
const execute = promisify(execFile)
export async function cleanup(path) {
  const { stdout } = await execute(
    'node',
    [`${root}/scripts/cleanup-migrator-lifecycle.mjs`, path],
    { cwd: root, timeout: 60000, maxBuffer: 1024 * 1024 }
  )
  assert.equal(existsSync(path), false, 'Independent recovery did not remove journal')
  return stdout.length
}
