import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  LOCALE_CATALOGUES,
  RESERVED_ROOT_SEGMENTS,
  readAdminConsoleSettings,
  readLocaleSettings,
  validateAdminConsoleSettings,
  validateLocaleSettings,
} from './settings-files.mjs'

const corpus = JSON.parse(
  readFileSync(
    new URL('../../packages/shared/src/constants/settings-contract.fixture.json', import.meta.url),
    'utf8'
  )
)

// The same files that `packages/shared` checks with its Zod schemas.
for (const [label, validate, cases] of [
  ['locales.json', validateLocaleSettings, corpus.locales],
  ['admin-console.json', validateAdminConsoleSettings, corpus.adminConsole],
]) {
  for (const { name, file } of cases.valid)
    test(`${label} accepts: ${name}`, () => assert.deepEqual(validate(file), []))
  for (const { name, file } of cases.invalid)
    test(`${label} refuses: ${name}`, () => assert.notDeepEqual(validate(file), []))
}

test('the catalogue list read from the shared source names exactly the shipped catalogues', () => {
  const messages = new URL('../../apps/web/messages/', import.meta.url)
  const shipped = readdirSync(messages)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort()
  assert.deepEqual([...LOCALE_CATALOGUES].sort(), shipped)
  assert.deepEqual(RESERVED_ROOT_SEGMENTS.slice(0, 3), ['api', '_next', '_vercel'])
})

test('the shipped settings files pass the script reader', () => {
  const root = path.resolve(import.meta.dirname, '../..')
  assert.ok(readLocaleSettings(root).enabled.length >= 1)
  assert.ok(readAdminConsoleSettings(root).alias.length >= 1)
})

function withSettings(files, run) {
  const root = mkdtempSync(path.join(tmpdir(), 'settings-files-'))
  try {
    const dir = path.join(root, 'packages/shared/src/config')
    mkdirSync(dir, { recursive: true })
    for (const [name, value] of Object.entries(files))
      writeFileSync(
        path.join(dir, `${name}.json`),
        typeof value === 'string' ? value : JSON.stringify(value)
      )
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('a refused file names the file and the field, and is not JSON-parsed twice', () => {
  withSettings({ locales: { version: 1, enabled: ['ru'], default: 'en' } }, (root) => {
    assert.throws(
      () => readLocaleSettings(root),
      /Invalid packages\/shared\/src\/config\/locales\.json: default \(LOCALE_DEFAULT_NOT_ENABLED\)/
    )
  })
  withSettings({ 'admin-console': '{ not json' }, (root) => {
    assert.throws(() => readAdminConsoleSettings(root), /admin-console\.json: not JSON/)
  })
  withSettings({ 'admin-console': { version: 1, mode: 'disabled', alias: 'ru' } }, (root) => {
    assert.throws(() => readAdminConsoleSettings(root), /alias \(ALIAS_RESERVED\)/)
  })
})
