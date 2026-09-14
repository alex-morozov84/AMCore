import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { OWNERSHIP_CODES, ownershipError } from './ownership-errors.mjs'
import { matchesGlob } from './ownership-glob.mjs'

function collect(root, relative, output) {
  const absolute = path.join(root, relative)
  const stat = statSync(absolute)
  output.set(relative.replaceAll('\\', '/'), stat.isDirectory() ? 'directory' : 'file')
  if (!stat.isDirectory()) return
  for (const name of readdirSync(absolute)) collect(root, path.join(relative, name), output)
}

export function listSurface(root, surfaceRoots) {
  const output = new Map()
  for (const relative of surfaceRoots) collect(root, relative, output)
  return output
}

function matchingPaths(surface, fact) {
  if (fact.path) return surface.has(fact.path) ? [fact.path] : []
  return [...surface.keys()].filter((item) => matchesGlob(item, fact.glob))
}

function assertCardinality(fact, matches) {
  const valid = fact.cardinality === 'one' ? matches.length === 1 : matches.length > 0
  if (valid) return
  const name = fact.path ?? fact.glob
  throw ownershipError(
    matches.length === 0 ? OWNERSHIP_CODES.STALE_ENTRY : OWNERSHIP_CODES.CARDINALITY,
    `${name} expected ${fact.cardinality}, found ${matches.length}`,
    matches
  )
}

function validateFact(surface, fact) {
  const matches = matchingPaths(surface, fact)
  assertCardinality(fact, matches)
  const wrong = matches.filter((item) => surface.get(item) !== fact.kind)
  if (wrong.length) {
    throw ownershipError(
      OWNERSHIP_CODES.KIND_MISMATCH,
      `${fact.path ?? fact.glob} kind drifted`,
      wrong
    )
  }
  return matches
}

function insideRoot(file, roots) {
  return roots.some((root) => file === root || file.startsWith(`${root}/`))
}

function validateWholeFeatureFiles(manifest, matches) {
  const roots = manifest.facts.roots.map((entry) => entry.path)
  const wholeFiles = [...manifest.facts.featureFiles, ...manifest.facts.featureEntrypoints]
  for (const fact of wholeFiles) {
    const outside = matches.get(fact).filter((file) => !insideRoot(file, roots))
    if (outside.length) {
      throw ownershipError(
        OWNERSHIP_CODES.OUTSIDE_ROOT,
        'feature-owned file must live in a root',
        outside
      )
    }
  }
}

function enumerateRootFiles(surface, manifest) {
  const roots = new Map()
  for (const fact of manifest.facts.roots) {
    roots.set(
      fact.path,
      [...surface.entries()]
        .filter(([file, kind]) => kind === 'file' && file.startsWith(`${fact.path}/`))
        .map(([file]) => file)
        .sort()
    )
  }
  return roots
}

export function validateManifestInventory(root, manifest) {
  const surface = listSurface(root, manifest.surfaceRoots)
  const matches = new Map()
  for (const facts of Object.values(manifest.facts)) {
    for (const fact of facts) matches.set(fact, validateFact(surface, fact))
  }
  for (const seam of manifest.seams) matches.set(seam, validateFact(surface, seam))
  validateWholeFeatureFiles(manifest, matches)
  return { surface, matches, rootFiles: enumerateRootFiles(surface, manifest) }
}

export function readInventoryFile(root, file) {
  return readFileSync(path.join(root, file), 'utf8')
}
