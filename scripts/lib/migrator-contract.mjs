import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, parseAllDocuments } from 'yaml'

const json = (root, path) => JSON.parse(readFileSync(join(root, path), 'utf8'))
const version = (entry) => entry?.version?.split('(')[0]

function applicationLock(root) {
  const documents = parseAllDocuments(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'))
  assert.ok(documents.length && documents.every((doc) => !doc.errors.length), 'Invalid root lock')
  const apps = documents.map((doc) => doc.toJS()).filter((doc) => doc?.importers?.['apps/api'])
  assert.equal(apps.length, 1, 'Root lock must hold exactly one application document')
  return apps[0]
}

function verifyRootFamily(api, locked, expected) {
  const family = [
    api.devDependencies.prisma,
    api.dependencies['@prisma/client'],
    api.dependencies['@prisma/adapter-pg'],
  ]
  assert.ok(
    family.every((value) => /^\d+\.\d+\.\d+$/.test(value) && value === expected),
    'Prisma family mismatch'
  )
  for (const name of ['@prisma/client', '@prisma/adapter-pg'])
    assert.equal(version(locked.dependencies[name]), expected, `Root lock ${name}`)
  assert.equal(version(locked.devDependencies.prisma), expected, 'Root CLI lock')
}

function verifyClosure(app, dependencies) {
  const seen = new Set()
  function visit(name, resolved) {
    assert.ok(
      !name.startsWith('@typescript/') && !(name === 'typescript' && resolved.startsWith('7.')),
      'Native compiler in migrator'
    )
    const key = `${name}@${resolved}`
    if (seen.has(key)) return
    seen.add(key)
    assert.ok(app.packages?.[key.split('(')[0]]?.resolution?.integrity, `Missing ${key} integrity`)
    const snapshot = app.snapshots?.[key]
    assert.ok(snapshot, `Missing migrator snapshot: ${key}`)
    for (const [child, value] of Object.entries({
      ...snapshot.dependencies,
      ...snapshot.optionalDependencies,
    }))
      visit(child, value)
  }
  const locked = app.importers['docker/migrator']?.dependencies
  assert.ok(locked, 'Migrator workspace importer missing')
  assert.deepEqual(
    Object.keys(locked).sort(),
    Object.keys(dependencies).sort(),
    'Unexpected migrator dependency'
  )
  for (const [name, expected] of Object.entries(dependencies)) {
    assert.equal(locked[name]?.specifier, expected, `Stale ${name} specifier`)
    assert.equal(version(locked[name]), expected, `Stale ${name} resolution`)
    visit(name, locked[name].version)
  }
}

function verifyPolicy(root) {
  const workspace = parse(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'))
  assert.ok(workspace.packages.includes('docker/migrator'), 'Migrator workspace member missing')
  assert.equal(workspace.minimumReleaseAge, 1440, 'Keep the 24-hour release-age cutoff')
  assert.equal(workspace.minimumReleaseAgeStrict, true)
  assert.equal(workspace.minimumReleaseAgeIgnoreMissingTime, false)
  assert.equal(workspace.minimumReleaseAgeExclude, undefined, 'Release-age exclusions forbidden')
  assert.equal(workspace.trustLockfile, undefined, 'Release-age verification must not be skipped')
  for (const name of ['prisma', '@prisma/engines'])
    assert.equal(workspace.allowBuilds[name], true, `${name} build script forbidden`)
  for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'installer.mjs'])
    assert.ok(!existsSync(join(root, 'docker/migrator', file)), `Obsolete migrator ${file}`)
}

export function verifyMigrator(root) {
  const manifest = json(root, 'docker/migrator/package.json')
  assert.equal(manifest.name, '@amcore/migrator')
  assert.equal(manifest.private, true)
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.packageManager, undefined, 'Use the root packageManager')
  assert.ok(!Object.keys(manifest.scripts ?? {}).length, 'Migrator must not run workspace scripts')
  assert.ok(
    !Object.keys(manifest.devDependencies ?? {}).length,
    'Migrator must not carry development dependencies'
  )
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ['dotenv', 'prisma'])
  assert.ok(
    Object.values(manifest.dependencies).every((value) => /^\d+\.\d+\.\d+$/.test(value)),
    'Migrator dependencies must be exact'
  )
  const app = applicationLock(root)
  verifyRootFamily(
    json(root, 'apps/api/package.json'),
    app.importers['apps/api'],
    manifest.dependencies.prisma
  )
  verifyClosure(app, manifest.dependencies)
  verifyPolicy(root)
  const pnpm = /^pnpm@(\d+\.\d+\.\d+)$/.exec(json(root, 'package.json').packageManager)?.[1]
  assert.ok(pnpm, 'Root packageManager must be exact')
  return { prisma: manifest.dependencies.prisma, pnpm }
}
