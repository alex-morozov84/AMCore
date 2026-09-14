import path from 'node:path'

import { readFileSync } from 'node:fs'

import { OWNERSHIP_CODES, ownershipError } from './ownership-errors.mjs'
import { filesForFacts, filesInRoots, pathsForSeams, seamMatchesFile } from './ownership-facts.mjs'
import { seamCoversDetector } from './ownership-seams.mjs'
import { identifierOccurrences, rangesOverlap, seamRanges } from './ownership-seam-ranges.mjs'

function featureTargets(manifest, inventory, projection) {
  const targets = filesInRoots(inventory)
  const shared = filesForFacts(inventory, manifest.facts.sharedModules)
  for (const file of shared) {
    if (!projection?.universalSharedModules.has(file)) targets.add(file)
  }
  return targets
}

function detectorsForFile(root, file, manifest, graph, targets) {
  const content = readFileSync(path.join(root, file), 'utf8')
  const detected = manifest.monitoredIdentifiers.flatMap((id) => identifierOccurrences(content, id))
  const imports = (graph.forward.get(file) ?? [])
    .filter((edge) => targets.has(edge.target))
    .map((edge) => ({ ...edge, detector: 'feature-import' }))
  return { content, detected: [...detected, ...imports] }
}

function declared(manifest, file, contribution, content) {
  return manifest.seams.some(
    (seam) =>
      seamMatchesFile(seam, file) &&
      seamCoversDetector(seam, contribution.detector) &&
      (contribution.detector === 'feature-import' &&
      seam.removeImports?.includes(contribution.target)
        ? true
        : seamRanges(content, seam).some((range) => rangesOverlap(range, contribution)))
  )
}

function exemptFiles(manifest, inventory) {
  const exempt = filesInRoots(inventory)
  for (const field of [
    'topology',
    'verification',
    'documentation',
    'sharedModules',
    'sharedModuleTests',
  ]) {
    for (const file of filesForFacts(inventory, manifest.facts[field])) exempt.add(file)
  }
  return exempt
}

export function detectUndeclaredContributions(
  root,
  manifest,
  inventory,
  graph,
  changedFiles,
  projection
) {
  const targets = featureTargets(manifest, inventory, projection)
  const exempt = exemptFiles(manifest, inventory)
  const scope = changedFiles ?? [...inventory.surface.keys()]
  const missing = []
  for (const file of scope.filter((item) => inventory.surface.get(item) === 'file')) {
    if (exempt.has(file)) continue
    const { content, detected } = detectorsForFile(root, file, manifest, graph, targets)
    for (const contribution of detected) {
      if (!declared(manifest, file, contribution, content)) {
        missing.push(`${file}:${contribution.detector}`)
      }
    }
  }
  if (missing.length) {
    throw ownershipError(
      OWNERSHIP_CODES.MISSING_SEAM,
      `detectable contributions need a declared seam: ${missing.join(', ')}`,
      missing.map((item) => item.split(':')[0])
    )
  }
  return []
}

export function relevantFiles(root, manifest, inventory, graph) {
  const targets = featureTargets(manifest, inventory)
  const relevant = new Set([...targets, ...pathsForSeams(inventory, manifest.seams)])
  for (const file of graph.files) {
    if (detectorsForFile(root, file, manifest, graph, targets).detected.length) relevant.add(file)
  }
  return relevant
}
