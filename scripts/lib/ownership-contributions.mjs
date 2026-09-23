import path from 'node:path'

import { readFileSync } from 'node:fs'

import { OWNERSHIP_CODES, ownershipError } from './ownership-errors.mjs'
import { filesForFacts, filesInRoots, pathsForSeams, seamMatchesFile } from './ownership-facts.mjs'
import { seamCoversDetector } from './ownership-seams.mjs'
import { identifierOccurrences, rangesOverlap, seamRanges } from './ownership-seam-ranges.mjs'

function featureTargets(manifest, inventory, projection) {
  if (projection) return new Set(projection.removed)
  const targets = filesInRoots(inventory)
  const shared = filesForFacts(inventory, manifest.facts.sharedModules)
  for (const file of shared) {
    if (!projection?.universalSharedModules.has(file)) targets.add(file)
  }
  return targets
}

function detectorsForFile(root, file, manifest, graph, targets, contents) {
  const content = contents?.get(file) ?? readFileSync(path.join(root, file), 'utf8')
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

function missingDetail(manifest, missing) {
  const detail = missing
    .map(({ file, detector, target }) => {
      const matched = target ? `import "${target}"` : `identifier "${detector}"`
      return `${manifest.feature}: "${file}" matched ${matched}; use a local fixture or register an owned block, config field, or structural operation`
    })
    .join('; ')
  if (detail.length <= 700) return detail
  return `${detail.slice(0, 650)}; ... ${missing.length} total violations`
}

function collectMissing(root, manifest, inventory, graph, changedFiles, projection, options) {
  const targets = featureTargets(manifest, inventory, projection)
  const exempt = exemptFiles(manifest, inventory)
  const scope = changedFiles ?? [...inventory.surface.keys()]
  const missing = []
  for (const file of scope.filter((item) => inventory.surface.get(item) === 'file')) {
    if (exempt.has(file) || projection?.removed.has(file)) continue
    const result = detectorsForFile(root, file, manifest, graph, targets, options.contents)
    for (const contribution of result.detected) {
      if (!declared(manifest, file, contribution, result.content)) {
        missing.push({ file, detector: contribution.detector, target: contribution.target })
      }
    }
  }
  return missing
}

export function detectUndeclaredContributions(
  root,
  manifest,
  inventory,
  graph,
  changedFiles,
  projection,
  options = {}
) {
  const missing = collectMissing(
    root,
    manifest,
    inventory,
    graph,
    changedFiles,
    projection,
    options
  )
  if (missing.length) {
    throw ownershipError(
      OWNERSHIP_CODES.MISSING_SEAM,
      `detectable contributions need a declared seam: ${missingDetail(manifest, missing)}`,
      missing.map((item) => item.file)
    )
  }
  return []
}

export function relevantFiles(root, manifest, inventory, graph, contents) {
  const targets = featureTargets(manifest, inventory)
  const relevant = new Set([...targets, ...pathsForSeams(inventory, manifest.seams)])
  for (const file of graph.files) {
    if (detectorsForFile(root, file, manifest, graph, targets, contents).detected.length) {
      relevant.add(file)
    }
  }
  return relevant
}
