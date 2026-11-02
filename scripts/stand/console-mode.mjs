import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { readAdminConsoleSettings } from '../lib/settings-files.mjs'

/** Sets the Console mode in a stand's source copy; a disabled Console cannot be switched on here. */
export async function setConsoleMode(snapshot, mode, disabledMessage) {
  const file = join(snapshot, 'packages/shared/src/config/admin-console.json')
  const settings = readAdminConsoleSettings(snapshot)
  if (settings.mode === 'disabled') throw new Error(disabledMessage)
  await writeFile(file, `${JSON.stringify({ ...settings, mode }, null, 2)}\n`)
}
