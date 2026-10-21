import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { inspectProductAdminPlacement } from './lib/product-admin-placement.mjs'

function fixture(t, localized = true) {
  const root = mkdtempSync(join(tmpdir(), 'amcore-placement-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, text = '') => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const routeRoot = `apps/web/src/app${localized ? '/[locale]' : ''}`
  const own = `${routeRoot}/(product-admin)/manage`
  write(
    'packages/shared/src/config/product-admin.json',
    JSON.stringify({ version: 1, mode: 'path', alias: 'manage' })
  )
  write(
    'packages/shared/src/constants/index.ts',
    "export const SUPPORTED_LOCALES = ['en', 'ru'] as const\nexport const DEFAULT_LOCALE = 'en'\n"
  )
  write('apps/web/public/favicon.ico')
  for (const page of ['login', 'organizations', 'settings/api-keys', 'settings/sessions'])
    write(`${own}/(ready)/${page}/page.tsx`)
  return { root, write, routeRoot, own }
}

test('grouped routes work with explicit locales and without a locale segment', (t) => {
  for (const localized of [true, false]) {
    const f = fixture(t, localized)
    const result = inspectProductAdminPlacement(f.root)
    assert.equal(result.localized, localized)
    assert.equal(result.routes.length, 4)
    assert.deepEqual(result.locales, ['en', 'ru'])
    assert.equal(result.defaultLocale, 'en')
  }
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
