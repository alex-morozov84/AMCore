import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { defineOwnershipManifest } from './ownership-manifest.mjs'

export const fileFact = (file, extra = {}) => ({
  path: file,
  kind: 'file',
  cardinality: 'one',
  ...extra,
})

export const dirFact = (file) => ({ path: file, kind: 'directory', cardinality: 'one' })

export function write(root, file, content = '') {
  const target = path.join(root, file)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
}

export function fixture(files = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'amcore-ownership-'))
  for (const directory of ['src', 'test', 'docs']) mkdirSync(path.join(root, directory))
  write(
    root,
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        allowJs: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        paths: { '@/*': ['./src/*'] },
      },
      include: ['src/**/*', 'test/**/*'],
    })
  )
  for (const [file, content] of Object.entries(files)) write(root, file, content)
  return root
}

export function testManifest(overrides = {}) {
  const facts = {
    roots: [dirFact('src/feature')],
    featureFiles: [],
    sharedModules: [],
    sharedModuleTests: [],
    topology: [],
    verification: [],
    documentation: [],
    featureEntrypoints: [fileFact('src/feature/entry.ts')],
    repositoryEntrypoints: [fileFact('src/app.ts')],
    ...overrides.facts,
  }
  return defineOwnershipManifest({
    feature: overrides.feature ?? 'feature',
    tags: { topology: ['disabled'], verification: ['test'] },
    surfaceRoots: overrides.surfaceRoots ?? ['src', 'test', 'docs', 'config.json'],
    tsconfigs: ['tsconfig.json'],
    testGlobs: ['test/**/*.ts'],
    monitoredIdentifiers: overrides.monitoredIdentifiers ?? ['FEATURE_TOKEN'],
    facts,
    seams: overrides.seams ?? [],
  })
}

export function graph(files, edges, kinds = {}) {
  const forward = new Map(files.map((file) => [file, []]))
  const reverse = new Map(files.map((file) => [file, []]))
  for (const [source, target] of edges) {
    const edge = { importer: source, target, specifier: target, dynamic: false }
    forward.get(source).push(edge)
    reverse.get(target).push(edge)
  }
  return {
    files,
    forward,
    reverse,
    unresolved: [],
    dynamic: [],
    aliases: ['@/*'],
    barrels: new Set(),
    kinds: new Map(files.map((file) => [file, kinds[file] ?? 'production'])),
  }
}
