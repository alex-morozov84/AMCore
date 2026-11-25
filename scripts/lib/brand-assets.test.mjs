import assert from 'node:assert/strict'
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import { prepareBrandInit } from './brand-init-plan.mjs'
import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { createFixtureRepo, fakePng, git } from './test-fixture.mjs'

let fixture
let assets
afterEach(() => {
  fixture?.cleanup()
  if (assets) rmSync(assets, { recursive: true, force: true })
})

test('asset facts pin bytes, mode, and repository-relative destination before confirmation', () => {
  fixture = createFixtureRepo()
  assets = mkdtempSync(path.join(tmpdir(), 'amcore-brand-assets-'))
  const source = path.join(assets, 'mark.png')
  const original = fakePng(64, 64)
  writeFileSync(source, original)
  chmodSync(source, 0o751)
  const plan = prepareBrandInit(fixture.root, { logoDarkSrc: source })
  writeFileSync(source, fakePng(32, 32))
  applyFilesystemTransaction({
    root: fixture.root,
    operations: plan.operationPlan.operationsForApply(),
  })
  const destination = path.join(fixture.root, 'apps/web/public/logo-dark.png')
  assert.ok(readFileSync(destination).equals(original))
  assert.equal(lstatSync(destination).mode & 0o7777, 0o751)
  assert.deepEqual(
    plan.operationPlan.operationsForApply().map((operation) => operation.target),
    ['apps/web/public/logo-dark.png']
  )
  assert.equal(JSON.stringify(plan.operationPlan.operationsForApply()).includes(assets), false)
  writeFileSync(source, original)
  assert.equal(
    prepareBrandInit(fixture.root, { logoDarkSrc: source }).operationPlan.operationCount,
    0
  )
  chmodSync(source, 0o640)
  assert.equal(
    prepareBrandInit(fixture.root, { logoDarkSrc: source }).operationPlan.operationCount,
    1
  )
})

test('asset planning rejects symlinks and validates the snapshotted icon bytes', () => {
  fixture = createFixtureRepo()
  assets = mkdtempSync(path.join(tmpdir(), 'amcore-brand-assets-'))
  const target = path.join(assets, 'target.png')
  const link = path.join(assets, 'link.png')
  writeFileSync(target, fakePng(192, 192))
  symlinkSync(target, link)
  assert.throws(() => prepareBrandInit(fixture.root, { icon192Src: link }), /regular file/)
  writeFileSync(target, fakePng(100, 100))
  assert.throws(() => prepareBrandInit(fixture.root, { icon192Src: target }), /expected 192x192/)
})

test('a missing destination refuses the asset without creating a file', () => {
  fixture = createFixtureRepo()
  assets = mkdtempSync(path.join(tmpdir(), 'amcore-brand-assets-'))
  const source = path.join(assets, 'mark.png')
  writeFileSync(source, fakePng(64, 64))
  const target = 'apps/web/public/logo-dark.png'
  rmSync(path.join(fixture.root, target))
  const prepare = () => prepareBrandInit(fixture.root, { logoDarkSrc: source })
  assert.throws(prepare, /Brand destination is missing.*Restore the starter file/)
  git(fixture.root, ['add', '-u'])
  git(fixture.root, [
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-m',
    'remove logo',
  ])
  assert.throws(prepare, /Brand destination is missing/)
  assert.equal(prepareBrandInit(fixture.root, {}).operationPlan.operationCount, 0)
})
