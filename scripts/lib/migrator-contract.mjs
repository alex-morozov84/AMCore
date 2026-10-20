import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, parseAllDocuments } from 'yaml'
import { installerPin } from '../../docker/migrator/installer.mjs'

const json = (root, path) => JSON.parse(readFileSync(join(root, path), 'utf8'))
const lock = (root, path) => {
  const documents = parseAllDocuments(readFileSync(join(root, path), 'utf8'))
  assert.ok(documents.length, `Empty lock: ${path}`)
  assert.ok(
    documents.every((doc) => !doc.errors.length),
    `Invalid lock: ${path}`
  )
  return documents.map((doc) => doc.toJS())
}
// pnpm 12 may prepend a package-manager document; the application graph is the one with the API importer.
const appDocument = (documents) => {
  const apps = documents.filter((doc) => doc?.importers?.['apps/api'])
  assert.equal(apps.length, 1, 'Root lock must hold exactly one application document')
  return apps[0]
}
const version = (entry) => entry?.version?.split('(')[0]

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

function verifyPackages(app, dependencies) {
  assert.ok(app, 'Migrator dependency graph missing')
  for (const [name, expected] of Object.entries(dependencies)) {
    assert.equal(
      app.importers['.'].dependencies[name]?.specifier,
      expected,
      `Stale ${name} specifier`
    )
    assert.equal(
      version(app.importers['.'].dependencies[name]),
      expected,
      `Stale ${name} resolution`
    )
    assert.ok(
      app.packages?.[`${name}@${expected}`]?.resolution?.integrity,
      `Missing ${name} integrity`
    )
  }
  assert.ok(app.packages?.[`@prisma/config@${dependencies.prisma}`], 'Config version mismatch')
  assert.ok(
    !Object.keys(app.packages).some((name) => /^(@typescript\/|typescript@7\.)/.test(name)),
    'Native compiler in migrator'
  )
}

function verifyPolicy(root) {
  const workspace = parse(readFileSync(join(root, 'docker/migrator/pnpm-workspace.yaml'), 'utf8'))
  assert.deepEqual(workspace.packages, [])
  assert.equal(workspace.minimumReleaseAgeStrict, true)
  assert.equal(workspace.minimumReleaseAgeExclude, undefined, 'Release-age exclusions forbidden')
  assert.equal(workspace.minimumReleaseAge, undefined, 'Keep the standard release-age cutoff')
}

export function verifyMigrator(root) {
  const manifest = json(root, 'docker/migrator/package.json')
  assert.equal(manifest.name, '@amcore/migrator')
  assert.equal(manifest.private, true)
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ['dotenv', 'prisma'])
  const pin = installerPin(manifest)
  verifyRootFamily(
    json(root, 'apps/api/package.json'),
    appDocument(lock(root, 'pnpm-lock.yaml')).importers['apps/api'],
    manifest.dependencies.prisma
  )
  const documents = lock(root, 'docker/migrator/pnpm-lock.yaml')
  assert.ok(
    documents.some(
      (doc) => version(doc.importers?.['.']?.packageManagerDependencies?.pnpm) === pin.version
    ),
    'Installer lock mismatch'
  )
  verifyPackages(
    documents.find((doc) => doc.importers?.['.']?.dependencies?.prisma),
    manifest.dependencies
  )
  verifyPolicy(root)
  return { prisma: manifest.dependencies.prisma, pnpm: pin.version }
}
