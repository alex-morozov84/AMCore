// Semantic-write derivation and cross-key conflict detection (BACKLOG item
// 14, PR2/M2, FINAL PLAN §2.2). A "semantic write" names *what conceptual
// property* an operation sets, distinct from the `operationKey` that names
// the operation itself — two different keys writing the same location to
// different values is a real conflict even when the underlying anchor
// still exists and the result would still parse/typecheck.
import { canonicalStringify } from './path-algebra-canonical.mjs'
import { PathAlgebraConflictError, CONFLICT_CODES } from './path-algebra-errors.mjs'

/**
 * Derives and mechanically validates one deduped fact's semantic writes via
 * its registered definition. A registered operation returning zero claims
 * for accepted params is a registry-definition bug, not a silent pass.
 */
export function deriveSemanticWrites(registry, dedupedFact) {
  const definition = registry.get(dedupedFact.operationKey)
  const writes = definition.deriveSemanticWrites(dedupedFact.params)
  if (!Array.isArray(writes) || writes.length === 0) {
    throw new PathAlgebraConflictError(CONFLICT_CODES.EMPTY_SEMANTIC_WRITES, {
      paths: [dedupedFact.path],
      dimensions: [...dedupedFact.dimensions],
      detail: `operationKey "${dedupedFact.operationKey}" derived no semantic write claims for "${dedupedFact.path}"`,
    })
  }
  return writes.map((write) => ({ ...write, canonicalValue: canonicalStringify(write.value) }))
}

/**
 * Rejects two *different* operation keys claiming the same semantic
 * location with different canonical values — checked before any adapter
 * runs. The same location claimed with the same value by different keys is
 * compatible (equivalent to independently agreeing, not a conflict).
 */
export function assertNoSemanticWriteConflicts(dedupedFacts, writesByKey) {
  const byLocation = new Map()
  for (const fact of dedupedFacts) {
    for (const write of writesByKey.get(fact.operationKey)) {
      const claim = { key: fact.operationKey, value: write.canonicalValue, dimensions: fact.dimensions }
      const existing = byLocation.get(write.location)
      if (!existing) {
        byLocation.set(write.location, claim)
        continue
      }
      if (existing.key === claim.key || existing.value === claim.value) continue
      throw new PathAlgebraConflictError(CONFLICT_CODES.SEMANTIC_WRITE_CONFLICT, {
        paths: [fact.path],
        dimensions: [...existing.dimensions, ...claim.dimensions],
        detail:
          `semantic location "${write.location}" on "${fact.path}" is claimed with different values by ` +
          `"${existing.key}" and "${claim.key}"`,
      })
    }
  }
}
