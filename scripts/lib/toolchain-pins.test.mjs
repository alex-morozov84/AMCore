import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseAllDocuments } from 'yaml'
import { installerPin } from '../../docker/migrator/installer.mjs'

const root = new URL('../..', import.meta.url).pathname
const read = (path) => readFileSync(join(root, path), 'utf8')
const manifest = JSON.parse(read('package.json'))
const pinned = /^pnpm@(\d+\.\d+\.\d+)$/.exec(manifest.packageManager)?.[1]

test('the root packageManager is an exact pnpm version', () => {
  assert.ok(pinned, 'packageManager must be pnpm@<major>.<minor>.<patch>')
})

test('both Dockerfiles prepare the root pnpm version through Corepack', () => {
  for (const file of ['apps/api/Dockerfile', 'apps/web/Dockerfile'])
    assert.deepEqual(
      [...read(file).matchAll(/corepack prepare pnpm@(\S+) --activate/g)].map((m) => m[1]),
      [pinned],
      file
    )
})

test('the stand installer fixture and the migrator installer use the same pnpm version', () => {
  assert.match(read('scripts/stand/linux-startup.test.mjs'), new RegExp(`pnpm@${pinned}'`))
  const migrator = JSON.parse(read('docker/migrator/package.json'))
  assert.equal(installerPin(migrator).version, pinned)
})

test('the root lock manager document and the engines floor match the pin', () => {
  const managers = parseAllDocuments(read('pnpm-lock.yaml'))
    .map((doc) => doc.toJS()?.importers?.['.']?.packageManagerDependencies?.pnpm?.version)
    .filter(Boolean)
  assert.deepEqual(managers, [pinned])
  assert.equal(manifest.engines.pnpm, `>=${pinned}`)
})
