import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { run } from './process.mjs'

export async function projectChoices(root) {
  const placement = JSON.parse(
    await readFile(join(root, 'packages/shared/src/config/product-admin.json'), 'utf8')
  )
  // Locale and Console choices come from the settings files, not from PROJECT_CONTEXT.md.
  const locales = JSON.parse(
    await readFile(join(root, 'packages/shared/src/config/locales.json'), 'utf8')
  )
  const adminConsole = JSON.parse(
    await readFile(join(root, 'packages/shared/src/config/admin-console.json'), 'utf8')
  )
  return {
    productAdminHost: placement.mode === 'host',
    consoleTopology: adminConsole.mode === 'host' ? 'host' : 'path',
    consoleEnabled: adminConsole.mode !== 'disabled',
    consoleSlug: adminConsole.alias,
    baseLocale: locales.default,
    localePrefix: locales.enabled.length === 1 ? '' : `/${locales.default}`,
    topology: placement.mode === 'host' || adminConsole.mode === 'host' ? 'host' : 'path',
    branch:
      (await run('git', ['branch', '--show-current'], { cwd: root, capture: true })).trim() ||
      'detached',
  }
}
