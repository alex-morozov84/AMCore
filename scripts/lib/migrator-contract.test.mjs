import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseAllDocuments, stringify } from 'yaml'
import { verifyMigrator } from './migrator-contract.mjs'

const root = new URL('../..', import.meta.url).pathname
const paths = [
  'package.json',
  'pnpm-workspace.yaml',
  'apps/api/package.json',
  'pnpm-lock.yaml',
  'docker/migrator',
]

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

function editLock(directory, change) {
  edit(directory, 'pnpm-lock.yaml', (text) => {
    const documents = parseAllDocuments(text).map((doc) => doc.toJS())
    change(documents.find((doc) => doc.importers?.['apps/api']))
    return documents.map((doc) => stringify(doc)).join('---\n')
  })
}

// The manager document precedes the application graph. TS7 in the API stays legal;
// Prisma's reachable upstream TS5 peer is legal in the migration graph.
test('the shared lock guards the migrator closure independently of the API compiler', () => {
  const manager = JSON.parse(readFileSync(join(root, 'package.json'))).packageManager
  assert.deepEqual(verifyMigrator(root), { prisma: '7.10.1', pnpm: manager.slice('pnpm@'.length) })
})

for (const name of ['prisma', '@prisma/client', '@prisma/adapter-pg'])
  test(`the coherence guard rejects an API ${name} mismatch`, () => {
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

for (const [label, change, message] of [
  ['missing importer', (app) => delete app.importers['docker/migrator'], /importer missing/],
  [
    'stale specifier',
    (app) => {
      app.importers['docker/migrator'].dependencies.prisma.specifier = '7.10.0'
    },
    /Stale prisma specifier/,
  ],
  [
    'stale resolution',
    (app) => {
      app.importers['docker/migrator'].dependencies.prisma.version = '7.10.0'
    },
    /Stale prisma resolution/,
  ],
  [
    'missing integrity',
    (app) => delete app.packages['dotenv@18.0.8'].resolution.integrity,
    /Missing dotenv.*integrity/,
  ],
  ['missing snapshot', (app) => delete app.snapshots['dotenv@18.0.8'], /Missing migrator snapshot/],
  [
    'transitive compiler',
    (app) => {
      app.snapshots['dotenv@18.0.8'].dependencies = { '@typescript/native': '7.0.2' }
    },
    /Native compiler/,
  ],
])
  test(`the shared lock guard rejects ${label}`, () => {
    fixture((directory) => {
      editLock(directory, change)
      assert.throws(() => verifyMigrator(directory), message)
    })
  })

for (const [label, change, message] of [
  [
    'missing application',
    (text) => text.replace('apps/api:', 'apps/other:'),
    /exactly one application document/,
  ],
  ['duplicate application', (text) => `${text}---\n${text}`, /exactly one application document/],
  ['invalid YAML', () => 'lockfileVersion: [invalid', /Invalid root lock/],
])
  test(`the root lock guard rejects ${label}`, () => {
    fixture((directory) => {
      edit(directory, 'pnpm-lock.yaml', change)
      assert.throws(() => verifyMigrator(directory), message)
    })
  })

for (const [field, value, message] of [
  ['scripts', { postinstall: 'node unrelated.js' }, /workspace scripts/],
  ['devDependencies', { typescript: '7.0.2' }, /development dependencies/],
  ['packageManager', 'pnpm@12.14.0', /root packageManager/],
])
  test(`minimal manifest refuses ${field}`, () => {
    fixture((directory) => {
      edit(directory, 'docker/migrator/package.json', (text) =>
        JSON.stringify({ ...JSON.parse(text), [field]: value })
      )
      assert.throws(() => verifyMigrator(directory), message)
    })
  })

for (const [setting, value, message] of [
  ['minimumReleaseAge', '0', /24-hour/],
  ['minimumReleaseAgeStrict', 'false', /false/],
  ['minimumReleaseAgeIgnoreMissingTime', 'true', /true/],
  ['minimumReleaseAgeExclude', "['prisma']", /exclusions forbidden/],
  ['trustLockfile', 'true', /must not be skipped/],
])
  test(`shared release-age guard refuses ${setting}=${value}`, () => {
    fixture((directory) => {
      edit(
        directory,
        'pnpm-workspace.yaml',
        (text) => `${text.replace(new RegExp(`^${setting}:.*$`, 'm'), '')}\n${setting}: ${value}\n`
      )
      assert.throws(() => verifyMigrator(directory), message)
    })
  })

test('a second migrator lock is rejected instead of silently becoming another authority', () => {
  fixture((directory) => {
    writeFileSync(join(directory, 'docker/migrator/pnpm-lock.yaml'), 'lockfileVersion: 12\n')
    assert.throws(() => verifyMigrator(directory), /Obsolete migrator pnpm-lock/)
  })
})
