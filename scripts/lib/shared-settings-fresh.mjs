import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// The settings files are bundled into `packages/shared/dist`. A web or API build that runs against
// a `dist` built from older settings would serve the old locales or Console mode. This check loads
// the built package and compares it with the two JSON files; it fails with the command to run.
const readJson = (root, name) =>
  JSON.parse(readFileSync(join(root, `packages/shared/src/config/${name}.json`), 'utf8'))

/** Returns a list of mismatches; empty means `dist` matches the settings files. */
export async function sharedSettingsProblems(root) {
  const entry = join(root, 'packages/shared/dist/index.js')
  if (!existsSync(entry)) return ['packages/shared/dist is missing']
  const built = await import(`${pathToFileURL(entry).href}?fresh=${Date.now()}`)
  const locales = readJson(root, 'locales')
  const adminConsole = readJson(root, 'admin-console')
  const problems = []
  if (JSON.stringify(built.SUPPORTED_LOCALES) !== JSON.stringify(locales.enabled))
    problems.push(
      `served locales: built ${JSON.stringify(built.SUPPORTED_LOCALES)}, settings ${JSON.stringify(locales.enabled)}`
    )
  if (built.DEFAULT_LOCALE !== locales.default)
    problems.push(`default locale: built ${built.DEFAULT_LOCALE}, settings ${locales.default}`)
  if (JSON.stringify(built.ADMIN_CONSOLE_SETTINGS) !== JSON.stringify(adminConsole))
    problems.push(
      `Console settings: built ${JSON.stringify(built.ADMIN_CONSOLE_SETTINGS)}, settings ${JSON.stringify(adminConsole)}`
    )
  return problems
}
