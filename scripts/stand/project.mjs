import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { run } from './process.mjs'

export async function projectChoices(root) {
  const context = await readFile(join(root, 'PROJECT_CONTEXT.md'), 'utf8')
  const field = (name) =>
    context
      .split('\n')
      .find((line) => line.startsWith(`- **${name}:** `))
      ?.slice(`- **${name}:** `.length)
  const placement = JSON.parse(
    await readFile(join(root, 'packages/shared/src/config/product-admin.json'), 'utf8')
  )
  return {
    productAdminHost: placement.mode === 'host',
    consoleTopology: field('admin_console_mode') === 'host' ? 'host' : 'path',
    consoleEnabled: field('admin_console') === 'enabled',
    consoleSlug: field('admin_console_slug') ?? 'admin',
    baseLocale: field('base_locale') ?? 'en',
    localePrefix: field('i18n_mode') === 'single' ? '' : `/${field('base_locale') ?? 'en'}`,
    topology: placement.mode === 'host' || field('admin_console_mode') === 'host' ? 'host' : 'path',
    branch:
      (await run('git', ['branch', '--show-current'], { cwd: root, capture: true })).trim() ||
      'detached',
  }
}
