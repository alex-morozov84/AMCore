// Semantic-write derivation, claim validation and conflict detection
// (BACKLOG item 14, PR2/M2, FINAL PLAN §2.2). A "semantic write" names *what
// conceptual property* an operation sets, distinct from the `operationKey`
// that names the operation itself — two keys writing the same location to
// different values is a real conflict even when the result would still
// parse/typecheck. Every claim is validated here, mechanically, before any
// comparison: a definition bug cannot pass as a silent "no claim".
import { canonicalStringify } from './path-algebra-canonical.mjs'
import { PathAlgebraConflictError, CONFLICT_CODES } from './path-algebra-errors.mjs'

function claimError(code, fact, detail) {
  return new PathAlgebraConflictError(code, {
    paths: [fact.path],
    dimensions: [...fact.dimensions],
    detail: `operationKey "${fact.operationKey}" on "${fact.path}": ${detail}`,
  })
}

/** A claim needs a non-empty `location` and a `value` with a canonical (JSON) form. */
function canonicalizeClaim(fact, claim, index) {
  const invalid = (reason) =>
    claimError(CONFLICT_CODES.INVALID_SEMANTIC_WRITE, fact, `claim #${index} ${reason}`)
  if (claim === null || typeof claim !== 'object') throw invalid('must be an object')
  if (typeof claim.location !== 'string' || claim.location.trim().length === 0) {
    throw invalid('must have a non-empty string "location"')
  }
  let canonicalValue
  try {
    canonicalValue = canonicalStringify(claim.value)
  } catch (error) {
    throw invalid(`has a "value" that cannot be canonicalized (${error.message})`)
  }
  if (typeof canonicalValue !== 'string') throw invalid('has a "value" with no canonical JSON form')
  return { location: claim.location, value: claim.value, canonicalValue }
}

/** Same location twice inside one key must agree; the duplicate collapses to one claim. */
function dedupeWithinKey(fact, claims) {
  const byLocation = new Map()
  for (const claim of claims) {
    const existing = byLocation.get(claim.location)
    if (!existing) byLocation.set(claim.location, claim)
    else if (existing.canonicalValue !== claim.canonicalValue) {
      throw claimError(
        CONFLICT_CODES.SEMANTIC_WRITE_CONFLICT,
        fact,
        `claims location "${claim.location}" with two different values inside one operation`
      )
    }
  }
  return [...byLocation.values()]
}

function callDeriveSemanticWrites(registry, fact) {
  try {
    return registry.get(fact.operationKey).deriveSemanticWrites(fact.params)
  } catch (error) {
    throw claimError(
      CONFLICT_CODES.INVALID_SEMANTIC_WRITE,
      fact,
      `deriveSemanticWrites threw "${error.message}"`
    )
  }
}

/**
 * Derives and validates one deduped fact's semantic writes via its
 * registered definition: non-empty array, well-formed claims, no
 * contradictory duplicate location within the operation. Each returned
 * claim carries its `canonicalValue` for cross-key comparison.
 */
export function deriveSemanticWrites(registry, dedupedFact) {
  const writes = callDeriveSemanticWrites(registry, dedupedFact)
  if (!Array.isArray(writes) || writes.length === 0) {
    throw claimError(
      CONFLICT_CODES.EMPTY_SEMANTIC_WRITES,
      dedupedFact,
      'derived no semantic write claims'
    )
  }
  return dedupeWithinKey(
    dedupedFact,
    writes.map((claim, index) => canonicalizeClaim(dedupedFact, claim, index))
  )
}

/**
 * Rejects two *different* operation keys claiming the same semantic
 * location with different canonical values — checked before any adapter
 * runs. The same location claimed with the same value by different keys is
 * compatible (equivalent to independently agreeing, not a conflict).
 */
export function assertNoSemanticWriteConflicts(dedupedFacts, writesByKey) {
  const byLocation = new Map()
  // Key order, so the diagnostic names the same pair the same way whatever
  // order the facts arrived in.
  const byKey = [...dedupedFacts].sort((a, b) => (a.operationKey < b.operationKey ? -1 : 1))
  for (const fact of byKey) {
    for (const write of writesByKey.get(fact.operationKey)) {
      const claim = {
        key: fact.operationKey,
        value: write.canonicalValue,
        dimensions: fact.dimensions,
      }
      const existing = byLocation.get(write.location)
      if (!existing) {
        byLocation.set(write.location, claim)
        continue
      }
      if (existing.value === claim.value) continue
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
