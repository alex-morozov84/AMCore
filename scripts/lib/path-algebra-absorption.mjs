// Ancestor-directory delete absorption/extraction classification for the
// path algebra (BACKLOG item 14, PR2/M1, FINAL PLAN §2.1).
import { isAncestor } from './path-algebra-normalize.mjs'
import { PathAlgebraConflictError, CONFLICT_CODES } from './path-algebra-errors.mjs'

function findAbsorption({ deletePaths, moveGraph, moveSourcePaths }) {
  const absorbedDeletes = new Set()
  const absorbedMoveSources = new Set()
  for (const dir of deletePaths) {
    for (const other of deletePaths) {
      if (other !== dir && isAncestor(dir, other)) absorbedDeletes.add(other)
    }
    for (const source of moveSourcePaths) {
      if (!isAncestor(dir, source)) continue
      const destination = moveGraph.finalDestinationOf(source)
      if (destination === dir || isAncestor(dir, destination)) absorbedMoveSources.add(source)
    }
  }
  return { absorbedDeletes, absorbedMoveSources }
}

/**
 * For every delete-directory path: absorbs descendant deletes (redundant —
 * the ancestor delete already covers them), and classifies each descendant
 * move source either as absorbed (its resolved destination also lands under
 * the same ancestor delete — the whole rename happens inside doomed
 * territory) or a genuine extraction (destination survives outside the
 * deleted tree). Each extraction is recorded as an explicit `{ moveSource,
 * ancestorDir }` ordering edge — the *surviving* ancestor delete only (an
 * absorbed intermediate directory never materializes, so an edge to it
 * would be meaningless for the caller's topological ordering) — so
 * materialization can guarantee the extraction executes before the
 * directory that would otherwise destroy it, not merely that both survive.
 */
export function classifyAncestorInteractions({ deletePaths, moveGraph, moveSourcePaths }) {
  const { absorbedDeletes, absorbedMoveSources } = findAbsorption({ deletePaths, moveGraph, moveSourcePaths })

  const extractionEdges = []
  for (const dir of deletePaths) {
    if (absorbedDeletes.has(dir)) continue
    for (const source of moveSourcePaths) {
      if (absorbedMoveSources.has(source) || !isAncestor(dir, source)) continue
      extractionEdges.push({ moveSource: source, ancestorDir: dir })
    }
  }
  return { absorbedDeletes, absorbedMoveSources, extractionEdges }
}

/**
 * Rejects the one interaction the compatibility table does not resolve
 * automatically: a move whose destination lands under a deleted directory
 * while its source does not — something being moved into doomed territory.
 * This is a real modeling conflict, not guessed at; it fails before
 * mutation, naming the directory, the source, and the destination.
 */
export function assertNoUnresolvedMoveIntoDoomedDirectory({ deletePaths, moveGraph, moveSourcePaths }) {
  for (const dir of deletePaths) {
    for (const source of moveSourcePaths) {
      if (isAncestor(dir, source)) continue
      const destination = moveGraph.finalDestinationOf(source)
      if (destination !== dir && !isAncestor(dir, destination)) continue
      throw new PathAlgebraConflictError(CONFLICT_CODES.UNRESOLVED_OVERLAP, {
        paths: [dir, source, destination],
        dimensions: moveGraph.dimensionsOf(source),
        detail:
          `move destination "${destination}" lands under directory "${dir}", ` +
          `which is deleted, but its source "${source}" is not`,
      })
    }
  }
}
