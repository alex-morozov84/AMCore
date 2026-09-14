// Same-key deduplication/conflict for structural facts sharing one path
// (BACKLOG item 14, PR2/M2, FINAL PLAN §2.2).
import { canonicalStringify } from './path-algebra-canonical.mjs'
import { PathAlgebraConflictError, CONFLICT_CODES } from './path-algebra-errors.mjs'

/**
 * Groups facts (already filtered to one path) by `operationKey`. Facts
 * sharing a key with identical canonical `params` deduplicate to one
 * representative (dimensions merged); facts sharing a key with *different*
 * canonical params conflict — an ambiguous, incompatible claim on one named
 * operation, rejected before any adapter runs.
 */
export function dedupeByOperationKey(facts) {
  const byKey = new Map()
  for (const fact of facts) {
    const canonicalParams = canonicalStringify(fact.params)
    const existing = byKey.get(fact.operationKey)
    if (!existing) {
      byKey.set(fact.operationKey, { ...fact, canonicalParams, dimensions: new Set([fact.dimension]) })
      continue
    }
    if (existing.canonicalParams === canonicalParams) {
      existing.dimensions.add(fact.dimension)
      continue
    }
    throw new PathAlgebraConflictError(CONFLICT_CODES.STRUCTURAL_PARAMS_CONFLICT, {
      paths: [fact.path],
      dimensions: [...existing.dimensions, fact.dimension],
      detail: `operationKey "${fact.operationKey}" on "${fact.path}" has two different declared params`,
    })
  }
  return [...byKey.values()]
}
