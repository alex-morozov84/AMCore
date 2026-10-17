import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { installerPin, verifyArchive } from '../../docker/migrator/installer.mjs'
import { verifyMigrator } from './migrator-contract.mjs'

const root = new URL('../..', import.meta.url).pathname
const paths = ['apps/api/package.json', 'pnpm-lock.yaml', 'docker/migrator']

function fixture(action) {
  const directory = mkdtempSync(join(tmpdir(), 'amcore-migrator-contract-'))
  try {
    for (const path of paths) cpSync(join(root, path), join(directory, path), { recursive: true })
    action(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function edit(directory, path, change) {
  const file = join(directory, path)
  writeFileSync(file, change(readFileSync(file, 'utf8')))
}

test('migrator version guard accepts both actual frozen graphs', () => {
  assert.deepEqual(verifyMigrator(root), { prisma: '7.10.1', pnpm: '12.11.2' })
})

for (const name of ['prisma', '@prisma/client', '@prisma/adapter-pg'])
  test(`migrator version guard rejects an API ${name} mismatch`, () => {
    fixture((directory) => {
      edit(directory, 'apps/api/package.json', (text) => {
        const manifest = JSON.parse(text)
        const dependencies = name === 'prisma' ? manifest.devDependencies : manifest.dependencies
        dependencies[name] = '7.10.0'
        return JSON.stringify(manifest)
      })
      assert.throws(() => verifyMigrator(directory), /Prisma family mismatch/)
    })
  })

for (const [change, message] of [
  [(text) => text.replace('specifier: 7.10.1', 'specifier: 7.10.0'), /Stale prisma specifier/],
  [(text) => text.replace('version: 7.10.1', 'version: 7.10.0'), /Stale prisma resolution/],
  [(text) => text.slice(0, text.indexOf('---', 3)), /dependency graph missing/],
  [() => 'lockfileVersion: [invalid', /Invalid lock/],
])
  test(`migrator rejects damaged nested lock: ${message.source}`, () => {
    fixture((directory) => {
      edit(directory, 'docker/migrator/pnpm-lock.yaml', change)
      assert.throws(() => verifyMigrator(directory), message)
    })
  })

test('installer verifies bytes before extraction, rejecting tampering and missing pins', () => {
  const bytes = Buffer.from('harmless fixture archive bytes')
  const hash = createHash('sha512').update(bytes).digest('hex')
  verifyArchive(bytes, hash)
  assert.throws(() => verifyArchive(Buffer.from('tampered'), hash), /integrity mismatch/)
  assert.throws(() => installerPin({ packageManager: 'pnpm@12.11.2' }), /SHA512/)
})

test('migrator refuses release-age exceptions', () => {
  fixture((directory) => {
    edit(
      directory,
      'docker/migrator/pnpm-workspace.yaml',
      (text) => `${text}\nminimumReleaseAgeExclude: ['prisma']\n`
    )
    assert.throws(() => verifyMigrator(directory), /exclusions forbidden/)
  })
})

for (const age of [0, 60])
  test(`migrator refuses an overridden release-age cutoff: ${age}`, () => {
    fixture((directory) => {
      edit(
        directory,
        'docker/migrator/pnpm-workspace.yaml',
        (text) => `${text}\nminimumReleaseAge: ${age}\n`
      )
      assert.throws(() => verifyMigrator(directory), /standard release-age cutoff/)
    })
  })

test('installer rejects root workspace selection and disabled executable signatures before download', () => {
  const installer = new URL('../../docker/migrator/installer.mjs', import.meta.url).pathname
  for (const [value, message] of [
    [undefined, /isolated migrator cwd/],
    ['0', /signature verification/],
  ]) {
    const env = { ...process.env }
    if (value === undefined) delete env.COREPACK_INTEGRITY_KEYS
    else env.COREPACK_INTEGRITY_KEYS = value
    const result = spawnSync(process.execPath, [installer], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 5000,
    })
    assert.equal(result.error, undefined)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, message)
  }
})
