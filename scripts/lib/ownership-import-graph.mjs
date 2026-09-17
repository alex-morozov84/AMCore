import path from 'node:path'

import { matchesGlob } from './ownership-glob.mjs'
import { isSourceFile, scanImports } from './ownership-import-scan.mjs'
import {
  configuredAliases,
  isRelevantSpecifier,
  loadTsconfigResolvers,
  readSource,
  resolveImport,
} from './ownership-import-resolver.mjs'

function addReverse(reverse, target, edge) {
  if (!reverse.has(target)) reverse.set(target, [])
  reverse.get(target).push(edge)
}

function classify(file, testGlobs) {
  return testGlobs.some((glob) => matchesGlob(file, glob)) ? 'test' : 'production'
}

function resolveRecords(root, resolvers, aliases, file, records) {
  const importer = path.join(root, file)
  return records.map((record) => ({
    ...record,
    importer: file,
    target: resolveImport(root, resolvers, importer, record.specifier),
    relevant: isRelevantSpecifier(record.specifier, aliases),
  }))
}

export function createImportGraph(root, manifest, inventory, options = {}) {
  const resolvers = loadTsconfigResolvers(root, manifest.tsconfigs)
  const aliases = configuredAliases(resolvers)
  const files = [...inventory.surface.entries()]
    .filter(([file, kind]) => kind === 'file' && isSourceFile(file))
    .map(([file]) => file)
  const forward = new Map(files.map((file) => [file, []]))
  const reverse = new Map(files.map((file) => [file, []]))
  const unresolved = []
  const dynamic = []
  const kinds = new Map()
  const barrels = new Set()
  for (const file of files) {
    kinds.set(file, classify(file, manifest.testGlobs))
    const source = options.contents?.get(file) ?? readSource(path.join(root, file))
    const scan = scanImports(file, source)
    if (scan.barrel) barrels.add(file)
    dynamic.push(...scan.unresolvedDynamic.map((item) => ({ ...item, importer: file })))
    const edges = resolveRecords(root, resolvers, aliases, file, scan.records)
    forward.set(
      file,
      edges.filter((edge) => edge.target)
    )
    unresolved.push(...edges.filter((edge) => !edge.target && edge.relevant))
    for (const edge of edges.filter((item) => item.target)) addReverse(reverse, edge.target, edge)
  }
  return { files, forward, reverse, unresolved, dynamic, kinds, aliases, barrels }
}
