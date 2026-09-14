// Main path-algebra reducer (BACKLOG item 14, PR2/M1, FINAL PLAN §2.1) —
// additive and standalone: not imported by, and does not import from, the
// existing engine (scripts/lib/init-engine.mjs, plan-steps.mjs,
// project-plan*.mjs). Takes a flat list of typed facts and produces one
// deterministic, order-independent list of materialized operations, or
// throws a `PathAlgebraConflictError` before anything would be mutated.
import { normalizeRelativePath, isAncestor } from './path-algebra-normalize.mjs'
import { buildMoveGraph } from './path-algebra-move-graph.mjs'
import {
  classifyAncestorInteractions,
  assertNoUnresolvedMoveIntoDoomedDirectory,
} from './path-algebra-absorption.mjs'
import { topologicalOrder } from './path-algebra-topological-order.mjs'
import { PathAlgebraConflictError, CONFLICT_CODES } from './path-algebra-errors.mjs'
import { validateFacts } from './path-algebra-facts.mjs'

function normalizeFact(fact) {
  if (fact.kind === 'move') {
    return { ...fact, from: normalizeRelativePath(fact.from), to: normalizeRelativePath(fact.to) }
  }
  return { ...fact, path: normalizeRelativePath(fact.path) }
}

function dedupeDeletes(deleteFacts) {
  const byPath = new Map()
  for (const fact of deleteFacts) {
    if (!byPath.has(fact.path)) byPath.set(fact.path, new Set())
    byPath.get(fact.path).add(fact.dimension)
  }
  return byPath
}

function assertNoDeleteConflicts(deleteByPath, moveGraph, contentFacts) {
  for (const path of deleteByPath.keys()) {
    if (!moveGraph.isSource(path)) continue
    throw new PathAlgebraConflictError(CONFLICT_CODES.DELETE_OF_MOVE_SOURCE, {
      paths: [path],
      dimensions: [...deleteByPath.get(path), ...moveGraph.dimensionsOf(path)],
      detail: `path "${path}" is both deleted and moved`,
    })
  }
  for (const fact of contentFacts) {
    if (!deleteByPath.has(fact.path)) continue
    throw new PathAlgebraConflictError(CONFLICT_CODES.DELETE_CONTENT_CONFLICT, {
      paths: [fact.path],
      dimensions: [...deleteByPath.get(fact.path), fact.dimension],
      detail: `path "${fact.path}" is both deleted and content-edited`,
    })
  }
}

function groupContentByEffectiveTarget(contentFacts, moveGraph) {
  const byTarget = new Map()
  for (const fact of contentFacts) {
    const target = moveGraph.isSource(fact.path) ? moveGraph.finalDestinationOf(fact.path) : fact.path
    if (!byTarget.has(target)) byTarget.set(target, [])
    byTarget.get(target).push(fact)
  }
  for (const facts of byTarget.values()) {
    facts.sort((a, b) => a.dimension.localeCompare(b.dimension) || a.path.localeCompare(b.path))
  }
  return byTarget
}

function isUnderADeletedDirectory(target, deletePaths) {
  return deletePaths.some((dir) => isAncestor(dir, target))
}

function deleteOperations(deletePaths, absorbedDeletes) {
  return deletePaths.filter((path) => !absorbedDeletes.has(path)).map((target) => ({ kind: 'delete', target }))
}

function moveOperations({ moveSourcePaths, absorbedMoveSources, moveGraph, contentByTarget, mergedTargets }) {
  const ops = []
  for (const source of moveSourcePaths) {
    if (absorbedMoveSources.has(source)) continue
    const to = moveGraph.finalDestinationOf(source)
    mergedTargets.add(to)
    ops.push({ kind: 'move', from: source, to, carriedContent: contentByTarget.get(to) ?? [] })
  }
  return ops
}

function contentOperations({ contentByTarget, mergedTargets, deletePaths }) {
  const ops = []
  for (const [target, facts] of contentByTarget) {
    if (mergedTargets.has(target) || isUnderADeletedDirectory(target, deletePaths)) continue
    ops.push({ kind: 'content', target, facts })
  }
  return ops
}

// Extractions must execute before the ancestor delete they were rescued from
// — a plain alphabetical sort cannot guarantee that, so `topologicalOrder`
// computes a real dependency order, not just a deterministic tie-break.
function materialize({ deletePaths, absorbedDeletes, moveGraph, moveSourcePaths, absorbedMoveSources, contentByTarget, extractionEdges }) {
  const mergedTargets = new Set()
  const operations = [
    ...deleteOperations(deletePaths, absorbedDeletes),
    ...moveOperations({ moveSourcePaths, absorbedMoveSources, moveGraph, contentByTarget, mergedTargets }),
    ...contentOperations({ contentByTarget, mergedTargets, deletePaths }),
  ]
  return topologicalOrder(operations, extractionEdges)
}

function partitionFacts(rawFacts) {
  const facts = validateFacts(rawFacts).map(normalizeFact)
  return {
    deleteFacts: facts.filter((f) => f.kind === 'delete'),
    moveFacts: facts.filter((f) => f.kind === 'move'),
    contentFacts: facts.filter((f) => f.kind === 'content'),
  }
}

/**
 * Reduces a flat list of `{ kind: 'delete'|'move'|'content', dimension,
 * path }` / `{ kind: 'move', dimension, from, to }` facts into one
 * deterministic list of materialized operations. Throws
 * `PathAlgebraConflictError` (or `InvalidPathError` for a malformed path)
 * before any mutation would occur. Result never depends on input array
 * order.
 */
export function reducePathAlgebra(rawFacts) {
  const { deleteFacts, moveFacts, contentFacts } = partitionFacts(rawFacts)

  const deleteByPath = dedupeDeletes(deleteFacts)
  const deletePaths = [...deleteByPath.keys()].sort()
  const moveGraph = buildMoveGraph(moveFacts)
  const moveSourcePaths = moveGraph.rootSources()

  assertNoDeleteConflicts(deleteByPath, moveGraph, contentFacts)
  assertNoUnresolvedMoveIntoDoomedDirectory({ deletePaths, moveGraph, moveSourcePaths })
  const { absorbedDeletes, absorbedMoveSources, extractionEdges } = classifyAncestorInteractions({
    deletePaths,
    moveGraph,
    moveSourcePaths,
  })

  return materialize({
    deletePaths,
    absorbedDeletes,
    moveGraph,
    moveSourcePaths,
    absorbedMoveSources,
    contentByTarget: groupContentByEffectiveTarget(contentFacts, moveGraph),
    extractionEdges,
  })
}
