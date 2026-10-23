import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseAllDocuments } from 'yaml'

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

test('the stand fixture and the official migrator bootstrap match the root pnpm version', () => {
  assert.match(read('scripts/stand/linux-startup.test.mjs'), new RegExp(`pnpm@${pinned}'`))
  const pins = [
    ...read('apps/api/Dockerfile').matchAll(
      /^FROM ghcr\.io\/pnpm\/pnpm:([^@]+)@sha256:([a-f0-9]{64}) AS migrator-pnpm$/gm
    ),
  ]
  assert.equal(pins.length, 1, 'Require one digest-pinned official bootstrap')
  assert.equal(pins[0][1], pinned)
  assert.match(read('apps/api/Dockerfile'), /COPY --from=migrator-pnpm \/opt\/pnpm \/opt\/pnpm/)
})

test('the root lock manager document and the engines floor match the pin', () => {
  const managers = parseAllDocuments(read('pnpm-lock.yaml'))
    .map((doc) => doc.toJS()?.importers?.['.']?.packageManagerDependencies?.pnpm?.version)
    .filter(Boolean)
  assert.deepEqual(managers, [pinned])
  assert.equal(manifest.engines.pnpm, `>=${pinned}`)
})
