import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { sharedSettingsProblems } from './shared-settings-fresh.mjs'
import { build, copyShared, root } from './shared-package-fixture.mjs'

// The check reads a built `packages/shared/dist`. A clean checkout has none, so the tests build
// the package once in their own temporary copy instead of relying on the working tree.
let base

before(() => {
  base = mkdtempSync(join(tmpdir(), 'amcore-shared-built-'))
  const shared = join(base, 'packages/shared')
  mkdirSync(shared, { recursive: true })
  copyShared(shared)
  build(shared)
})
after(() => rmSync(base, { recursive: true, force: true }))

function copy(t) {
  const dir = mkdtempSync(join(tmpdir(), 'amcore-shared-fresh-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  cpSync(join(base, 'packages/shared/dist'), join(dir, 'packages/shared/dist'), {
    recursive: true,
  })
  cpSync(join(base, 'packages/shared/package.json'), join(dir, 'packages/shared/package.json'))
  cpSync(join(base, 'packages/shared/src/config'), join(dir, 'packages/shared/src/config'), {
    recursive: true,
  })
  // The built package imports zod; resolve it from the real install.
  symlinkSync(join(root, 'packages/shared/node_modules'), join(dir, 'packages/shared/node_modules'))
  return dir
}

test('the built package matches the settings files', async () => {
  assert.deepEqual(await sharedSettingsProblems(base), [])
})

test('a changed locale list, default or Console mode is reported', async (t) => {
  const dir = copy(t)
  const config = (name, value) =>
    writeFileSync(join(dir, `packages/shared/src/config/${name}.json`), JSON.stringify(value))
  config('locales', { version: 1, enabled: ['ru'], default: 'ru' })
  config('admin-console', { version: 1, mode: 'disabled', alias: 'admin' })
  const problems = await sharedSettingsProblems(dir)
  assert.equal(problems.length, 3)
  assert.match(problems.join('\n'), /served locales/)
  assert.match(problems.join('\n'), /default locale/)
  assert.match(problems.join('\n'), /Console settings/)
})

test('a missing build is reported', async (t) => {
  const dir = copy(t)
  rmSync(join(dir, 'packages/shared/dist'), { recursive: true })
  assert.deepEqual(await sharedSettingsProblems(dir), ['packages/shared/dist is missing'])
})
