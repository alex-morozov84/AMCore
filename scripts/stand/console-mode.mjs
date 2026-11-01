import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Sets the Console mode in a stand's source copy; a disabled Console cannot be switched on here. */
export async function setConsoleMode(snapshot, mode, disabledMessage) {
  const file = join(snapshot, 'packages/shared/src/config/admin-console.json')
  const settings = JSON.parse(await readFile(file, 'utf8'))
  if (settings.mode === 'disabled') throw new Error(disabledMessage)
  await writeFile(file, `${JSON.stringify({ ...settings, mode }, null, 2)}\n`)
}
