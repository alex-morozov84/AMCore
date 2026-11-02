import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { readAdminConsoleSettings, readLocaleSettings } from '../lib/settings-files.mjs'
import { snapshot } from '../stand/snapshot.mjs'

const exists = async (path) => Boolean(await stat(path).catch(() => undefined))
const read = (root, path) => readFile(join(root, path), 'utf8')
export const template = (name) => readFile(new URL(name, import.meta.url), 'utf8')

export function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`Example source anchor changed: ${before}`)
  return source.replace(before, after)
}

export async function exampleContext(root) {
  const text = await read(root, 'PROJECT_CONTEXT.md')
  const adminConsole = readAdminConsoleSettings(root)
  const locales = readLocaleSettings(root).enabled
  const single = locales.length === 1
  // Settings files own the locale and Console choices; the other fields stay in PROJECT_CONTEXT.md.
  const settings = {
    i18n_mode: single ? 'single' : 'multi',
    admin_console: adminConsole.mode === 'disabled' ? 'disabled' : 'enabled',
    admin_console_mode: adminConsole.mode === 'host' ? 'host' : 'path',
    admin_console_slug: adminConsole.alias,
  }
  const field = (name) =>
    settings[name] ?? text.match(new RegExp(`^- \\*\\*${name}:\\*\\*\\s+(.+)$`, 'm'))?.[1]
  // The physical locale folder is always present: a one-locale build rewrites onto it.
  const prefix = 'apps/web/src/app/[locale]'
  if (!(await exists(join(root, prefix)))) throw new Error('The locale route folder is missing')
  for (const locale of locales) await read(root, `apps/web/messages/${locale}.json`)
  if (!(await exists(join(root, prefix, adminConsole.alias))))
    throw new Error('Console alias disagrees with its physical routes')
  const placement = JSON.parse(await read(root, 'packages/shared/src/config/product-admin.json'))
  if (placement.mode !== 'path')
    throw new Error('Custom path examples require path placement; use the ready host recipe')
  if (!(await exists(join(root, prefix, '(product-admin)', placement.alias))))
    throw new Error('Product administration alias disagrees with its physical routes')
  const mounts = {}
  for (const name of ['members', 'roles', 'invitations']) {
    const path = `apps/web/src/_app/organization-access/ui/${name}-mount.tsx`
    const content = await read(root, path)
    const entry = content.includes(`@/_pages/custom-${name}`)
      ? `@/_pages/custom-${name}`
      : `@/_pages/organization-${name}`
    replaceOnce(content, entry, '')
    mounts[name] = { path, content }
  }
  const entryPath = 'apps/web/src/_app/organization-access/index.server.ts'
  const entry = await read(root, entryPath)
  replaceOnce(entry, "export { OrganizationInvitationsMount } from './ui/invitations-mount'", '')
  return { root, prefix, locales, single, mounts, entryPath, entry, field }
}

export async function prepareExample(
  kind,
  flags = process.argv.slice(2),
  source = resolve(import.meta.dirname, '../..'),
  preflight = async () => {}
) {
  if (flags.some((flag) => !(kind === 'shop' ? ['--preview'] : []).includes(flag)))
    throw new Error('Unknown example flag')
  const context = await exampleContext(source)
  if (kind !== 'shop' && !context.mounts[kind].content.includes(`@/_pages/organization-${kind}`))
    throw new Error('This example is already installed; use the current generated copy')
  await preflight(context)
  const root = await mkdtemp(join(tmpdir(), `amcore-${kind}-headless-`))
  await snapshot(source, root)
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  return exampleContext(root)
}

export async function writeExample(context, files) {
  const copy = JSON.parse(await template('product-admin-example-messages.json.fixture'))
  for (const locale of context.locales) {
    const path = `apps/web/messages/${locale}.json`
    const messages = JSON.parse(await read(context.root, path))
    messages.productAdminExample = copy[locale]
    files[path] = `${JSON.stringify(messages, null, 2)}\n`
  }
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(context.root, path)), { recursive: true })
    await writeFile(join(context.root, path), content)
  }
}

export function exampleInstructions(context, kind, fixture = '') {
  console.log(`Prepared ${kind} headless example: ${context.root}`)
  console.log('Install: pnpm install --frozen-lockfile')
  console.log('Prepare: node scripts/api-e2e-ci.mjs --prepare')
  console.log('Check generated code: pnpm --filter web lint; pnpm --filter web typecheck')
  console.log(
    `Run: pnpm stand e2e --lane real-stack ${fixture}-- organization-${kind}-headless.spec.ts`
  )
  console.log('Run these commands inside the printed directory.')
}

export async function memberTemplates(page) {
  const files = {
    [`${page}/custom-members.tsx`]: await template(
      'organization-members-headless-client.tsx.fixture'
    ),
  }
  for (const name of ['roles', 'keys', 'removal'])
    files[`${page}/member-${name}.tsx`] = await template(`organization-members-${name}.tsx.fixture`)
  return files
}
