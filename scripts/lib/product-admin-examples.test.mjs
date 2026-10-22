import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import {
  exampleContext,
  prepareExample,
  replaceOnce,
} from '../fixtures/product-admin-example-context.mjs'

const root = resolve(import.meta.dirname, '../..')
const read = (path) => readFile(join(root, path), 'utf8')
async function selectedSource() {
  const dir = await mkdtemp(join(tmpdir(), 'amcore-example-contract-'))
  const files = [
    'PROJECT_CONTEXT.md',
    'packages/shared/src/constants/index.ts',
    'packages/shared/src/config/product-admin.json',
    'apps/web/src/shared/lib/route-progress/route-progress-flag.ts',
    'apps/web/messages/ru.json',
    'apps/web/src/_app/organization-access/index.server.ts',
    ...['members', 'roles', 'invitations'].map(
      (name) => `apps/web/src/_app/organization-access/ui/${name}-mount.tsx`
    ),
  ]
  for (const path of files) {
    let contents = await read(path)
    if (path === 'PROJECT_CONTEXT.md')
      contents = contents
        .replace('`upstream-starter`', '`downstream-product`')
        .replace('**i18n_mode:** multi', '**i18n_mode:** single')
        .replace('**base_locale:** en', '**base_locale:** ru')
        .replace('**supported_locales:** [en, ru]', '**supported_locales:** [ru]')
        .replace('**admin_console:** enabled', '**admin_console:** disabled')
        .replace('**frontend_storybook:** enabled', '**frontend_storybook:** disabled')
        .replace('**frontend_route_progress:** enabled', '**frontend_route_progress:** disabled')
    if (path.endsWith('constants/index.ts'))
      contents = contents
        .replace("SUPPORTED_LOCALES = ['en', 'ru']", "SUPPORTED_LOCALES = ['ru']")
        .replace("DEFAULT_LOCALE: SupportedLocale = 'en'", "DEFAULT_LOCALE: SupportedLocale = 'ru'")
    if (path.endsWith('route-progress-flag.ts'))
      contents = contents.replace('ROUTE_PROGRESS_ENABLED = true', 'ROUTE_PROGRESS_ENABLED = false')
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), contents)
  }
  await mkdir(join(dir, 'apps/web/src/app/(product-admin)/manage'), { recursive: true })
  await writeFile(
    join(dir, 'apps/web/src/app/(product-admin)/manage/page.tsx'),
    'export default function Page() { return null }\n'
  )
  // Git inventory is a snapshot prerequisite, not an authoring commit or stand allocation.
  execFileSync('git', ['init', '--quiet', dir])
  return dir
}

test('already selected RU/no-Console source stays selected; a repeated projection refuses', async () => {
  const source = await selectedSource()
  let generated
  try {
    const context = await exampleContext(source)
    assert.equal(context.single, true)
    assert.deepEqual(context.locales, ['ru'])
    await assert.rejects(prepareExample('roles', ['--projected'], source), /upstream demonstration/)
    generated = await prepareExample('roles', [], source)
    assert.equal(generated.prefix, 'apps/web/src/app')
    assert.deepEqual(generated.locales, ['ru'])
    await assert.rejects(readFile(join(generated.root, 'apps/web/src/app/[locale]/layout.tsx')), {
      code: 'ENOENT',
    })
    await assert.rejects(readFile(join(generated.root, 'apps/web/messages/en.json')), {
      code: 'ENOENT',
    })
  } finally {
    if (generated) await rm(generated.root, { recursive: true, force: true })
    await rm(source, { recursive: true, force: true })
  }
})

test('context mismatch and ambiguous mount anchors refuse rather than guessing', async () => {
  const source = await selectedSource()
  try {
    await mkdir(join(source, 'apps/web/src/app/[locale]'))
    await assert.rejects(exampleContext(source), /locale subtree/)
    assert.throws(() => replaceOnce('anchor anchor', 'anchor', 'replacement'), /anchor changed/)
  } finally {
    await rm(source, { recursive: true, force: true })
  }
})

test('the actual roles generator replaces the admitted mount and never adds a legacy page', async () => {
  const stdout = execFileSync(
    process.execPath,
    ['scripts/fixtures/organization-roles-headless.mjs'],
    { cwd: root, encoding: 'utf8' }
  )
  const generated = stdout.match(/Prepared roles headless example: (.+)/)?.[1]
  assert.ok(generated)
  try {
    const mount = await readFile(
      join(generated, 'apps/web/src/_app/organization-access/ui/roles-mount.tsx'),
      'utf8'
    )
    assert.match(mount, /loadManagedOrganization/)
    assert.match(mount, /@\/_pages\/custom-roles/)
    const legacy = 'apps/web/src/app/[locale]/(organization-access)/organizations/[id]/roles'
    await assert.rejects(readFile(join(generated, legacy, 'page.tsx')), { code: 'ENOENT' })
    assert.equal(
      await readFile(join(generated, 'PROJECT_CONTEXT.md'), 'utf8'),
      await read('PROJECT_CONTEXT.md')
    )
  } finally {
    await rm(generated, { recursive: true, force: true })
  }
})

test('shop replaces effective palette blocks and preserves fonts and charts', async () => {
  const stdout = execFileSync(
    process.execPath,
    ['scripts/fixtures/organization-shop-headless.mjs'],
    { cwd: root, encoding: 'utf8' }
  )
  const generated = stdout.match(/Prepared shop headless example: (.+)/)?.[1]
  assert.ok(generated)
  try {
    const original = await read('apps/web/src/app/globals.css')
    const css = await readFile(join(generated, 'apps/web/src/app/globals.css'), 'utf8')
    const tokens = JSON.parse(
      await read('scripts/fixtures/organization-shop-headless.tokens.json.fixture')
    )
    for (const [selector, values] of Object.entries(tokens)) {
      const blocks = [
        ...css.matchAll(
          new RegExp(`^${selector === ':root' ? ':root' : '\\.dark'} \\{[^}]+\\}`, 'gm')
        ),
      ]
      assert.equal(blocks.length, 1)
      for (const [name, value] of Object.entries(values))
        assert.ok(blocks[0][0].includes(`--${name}: ${value};`))
    }
    const preserved = (text) => text.split('\n').filter((line) => /--(?:chart-|font-)/.test(line))
    assert.deepEqual(preserved(css), preserved(original))
    assert.notEqual(css, original)
    const ui = join(generated, 'apps/web/src/_pages/shop-team/ui')
    assert.match(await readFile(join(ui, 'shop-team.tsx'), 'utf8'), /ShopOperations/)
    for (const module of ['directory', 'dossier', 'operations', 'roles', 'keys', 'membership'])
      assert.ok((await readFile(join(ui, `shop-${module}.tsx`), 'utf8')).length)
    await assert.rejects(readFile(join(ui, 'custom-members.tsx')), { code: 'ENOENT' })
  } finally {
    await rm(generated, { recursive: true, force: true })
  }
})

test('members, roles and invitations compose without losing earlier mounts', async () => {
  const copies = []
  try {
    let source = root
    for (const kind of ['members', 'roles', 'invitations']) {
      const stdout = execFileSync(
        process.execPath,
        [`scripts/fixtures/organization-${kind}-headless.mjs`],
        { cwd: source, encoding: 'utf8' }
      )
      source = stdout.match(new RegExp(`Prepared ${kind} headless example: (.+)`))?.[1]
      assert.ok(source)
      copies.push(source)
    }
    for (const kind of ['members', 'roles', 'invitations']) {
      const mount = await readFile(
        join(source, `apps/web/src/_app/organization-access/ui/${kind}-mount.tsx`),
        'utf8'
      )
      assert.ok(mount.includes(`@/_pages/custom-${kind}`))
    }
    assert.equal(
      await readFile(join(source, 'PROJECT_CONTEXT.md'), 'utf8'),
      await read('PROJECT_CONTEXT.md')
    )
  } finally {
    for (const copy of copies) await rm(copy, { recursive: true, force: true })
  }
})
