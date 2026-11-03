import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { inspectProductAdminPlacement } from './lib/product-admin-placement.mjs'

function fixture(t, multi = true) {
  const root = mkdtempSync(join(tmpdir(), 'amcore-placement-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, text = '') => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  // The physical [locale] folder exists in every build; `multi` decides the public prefix.
  const routeRoot = 'apps/web/src/app/[locale]'
  const own = `${routeRoot}/(product-admin)/manage`
  write(
    'packages/shared/src/config/product-admin.json',
    JSON.stringify({ version: 1, mode: 'path', alias: 'manage' })
  )
  write(
    'packages/shared/src/config/locales.json',
    JSON.stringify({ version: 1, enabled: multi ? ['en', 'ru'] : ['en'], default: 'en' })
  )
  write(
    'packages/shared/src/config/admin-console.json',
    JSON.stringify({ version: 1, mode: 'path', alias: 'admin' })
  )
  write(`${routeRoot}/admin/page.tsx`)
  write('apps/web/public/favicon.ico')
  for (const page of ['login', 'organizations', 'settings/api-keys', 'settings/sessions'])
    write(`${own}/(ready)/${page}/page.tsx`)
  return { root, write, routeRoot, own }
}

test('grouped routes work with several locales and with one locale', (t) => {
  for (const multi of [true, false]) {
    const f = fixture(t, multi)
    const result = inspectProductAdminPlacement(f.root)
    assert.equal(result.localized, multi)
    assert.equal(result.routes.length, 4)
    assert.deepEqual(result.locales, multi ? ['en', 'ru'] : ['en'])
    assert.equal(result.defaultLocale, 'en')
  }
})

test('the Console alias must be free, physical and distinct from the product-admin alias', (t) => {
  const f = fixture(t)
  const consoleConfig = 'packages/shared/src/config/admin-console.json'
  const setAlias = (alias) =>
    f.write(consoleConfig, JSON.stringify({ version: 1, mode: 'disabled', alias }))
  setAlias('manage')
  assert.throws(() => inspectProductAdminPlacement(f.root), /equals the product-admin alias/)
  setAlias('console')
  assert.throws(() => inspectProductAdminPlacement(f.root), /physical routes/)
  f.write(`${f.routeRoot}/console/page.tsx`)
  assert.doesNotThrow(() => inspectProductAdminPlacement(f.root))
  f.write(`${f.routeRoot}/(other)/console/extra/page.tsx`)
  assert.throws(() => inspectProductAdminPlacement(f.root), /Console alias collides/)
  setAlias('en')
  // A locale name is refused by the shared settings rules (the code ALIAS_RESERVED), before any route check.
  assert.throws(() => inspectProductAdminPlacement(f.root), /ALIAS_RESERVED/)
})

test('a public asset cannot take the Console alias', (t) => {
  const f = fixture(t)
  f.write('apps/web/public/admin.svg')
  assert.throws(
    () => inspectProductAdminPlacement(f.root),
    /Console alias collides with public asset/
  )
})

test('candidate alias preflight does not move physical routes or alter source config', (t) => {
  const f = fixture(t)
  assert.equal(inspectProductAdminPlacement(f.root, 'office').alias, 'office')
  assert.equal(inspectProductAdminPlacement(f.root).alias, 'manage')
})

for (const name of ['admin', 'login', 'api', 'en', 'ru']) {
  test(`rejects reserved or actual route collision: ${name}`, (t) => {
    const f = fixture(t)
    f.write(`${f.routeRoot}/(other)/${name}/page.tsx`)
    assert.throws(() => inspectProductAdminPlacement(f.root, name), /collides/)
  })
}

test('rejects public assets and metadata occupying the alias', (t) => {
  const f = fixture(t)
  f.write('apps/web/public/office.svg')
  f.write(`${f.routeRoot}/sitemap.ts`)
  assert.throws(() => inspectProductAdminPlacement(f.root, 'office'), /public asset/)
  assert.throws(() => inspectProductAdminPlacement(f.root, 'sitemap'), /collides/)
})

test('rejects a dynamic root which can intercept the admin alias', (t) => {
  const f = fixture(t)
  f.write(`${f.routeRoot}/(other)/[...slug]/page.tsx`)
  assert.throws(() => inspectProductAdminPlacement(f.root), /collides/)
})

test('rejects a missing physical subtree and an extra sibling subtree', (t) => {
  const f = fixture(t)
  renameSync(join(f.root, f.own), join(f.root, f.own.replace('/manage', '/office')))
  assert.throws(() => inspectProductAdminPlacement(f.root), /disagree/)
  renameSync(join(f.root, f.own.replace('/manage', '/office')), join(f.root, f.own))
  f.write(`${f.routeRoot}/(product-admin)/office/page.tsx`)
  assert.throws(() => inspectProductAdminPlacement(f.root), /exactly/)
})

test('rejects missing required session page', (t) => {
  const f = fixture(t)
  rmSync(join(f.root, `${f.own}/(ready)/settings/sessions`), { recursive: true })
  assert.throws(() => inspectProductAdminPlacement(f.root), /Missing.*sessions/)
})

for (const alias of ['../manage', 'https://example.test', 'foo/bar', 'ru?x', 'Manage', '']) {
  test(`rejects malformed alias ${JSON.stringify(alias)}`, (t) => {
    const f = fixture(t)
    assert.throws(() => inspectProductAdminPlacement(f.root, alias), /Invalid/)
  })
}

test('rejects unknown source fields instead of silently ignoring them', (t) => {
  const f = fixture(t)
  f.write(
    'packages/shared/src/config/product-admin.json',
    JSON.stringify({ version: 1, mode: 'path', alias: 'manage', origin: 'https://example.test' })
  )
  assert.throws(() => inspectProductAdminPlacement(f.root), /Invalid/)
})
