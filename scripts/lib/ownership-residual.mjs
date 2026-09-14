import { OWNERSHIP_CODES, ownershipError } from './ownership-errors.mjs'
import { filesInRoots, pathsForSeams } from './ownership-facts.mjs'
import { seamRanges } from './ownership-seam-ranges.mjs'

function residualSeamDetectors(selection, files, contents) {
  const residuals = []
  const seams = selection.manifest.seams.filter((seam) => seam.disposition === 'remove')
  for (const seam of seams) {
    for (const file of pathsForSeams(selection.inventory, [seam])) {
      if (!files.has(file)) continue
      const content = contents.get(file) ?? ''
      if (seamRanges(content, seam).length) residuals.push(`${file}:${seam.id}`)
    }
  }
  return residuals
}

export function assertProjectionResiduals(selections, projection, files, contents) {
  const residuals = []
  for (const selection of selections) {
    for (const file of filesInRoots(selection.inventory)) {
      if (files.has(file)) residuals.push(file)
    }
    residuals.push(...residualSeamDetectors(selection, files, contents))
  }
  for (const [source, edges] of projection.forward) {
    for (const edge of edges) {
      if (projection.removed.has(edge.target)) residuals.push(`${source}->${edge.target}`)
    }
  }
  if (residuals.length) {
    throw ownershipError(
      OWNERSHIP_CODES.RESIDUAL,
      `projection left owned semantics: ${residuals.join(', ')}`,
      residuals
    )
  }
}
