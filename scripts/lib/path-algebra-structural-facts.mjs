// Validates a `structural` fact against a registry before it enters
// composition (BACKLOG item 14, PR2/M2, FINAL PLAN §2.2). Call sites supply
// only `{ dimension, path, operationKey, params }` — never an adapter.
import { normalizeRelativePath } from './path-algebra-normalize.mjs'
import { PathAlgebraConflictError, CONFLICT_CODES } from './path-algebra-errors.mjs'

function requireString(value, field) {
  if (typeof value === 'string' && value.length > 0) return value
  throw new TypeError(`structural fact "${field}" must be a non-empty string`)
}

function invalidParams(fact, reason) {
  return new PathAlgebraConflictError(CONFLICT_CODES.INVALID_OPERATION_PARAMS, {
    paths: [fact.path],
    dimensions: [fact.dimension],
    detail: `operationKey "${fact.operationKey}" ${reason} for "${fact.path}"`,
  })
}

/**
 * Runs the definition's `paramsSchema`. A schema that *throws* (a bug in the
 * schema, or a validator that reports by throwing) is not allowed to escape
 * as an opaque exception — it is the same diagnosable validation failure as
 * a schema that returns `false`, with the thrown message preserved.
 */
function assertParamsAccepted(definition, fact) {
  let accepted
  try {
    accepted = definition.paramsSchema(fact.params)
  } catch (error) {
    throw invalidParams(fact, `params schema threw "${error?.message ?? String(error)}"`)
  }
  if (accepted !== true) throw invalidParams(fact, 'rejected its params')
}

/**
 * Validates one structural fact: the operation key must be registered, and
 * its params must pass that key's own `paramsSchema`. Normalizes `path`.
 * Throws `PathAlgebraConflictError` (unknown key / invalid params) or
 * `InvalidPathError` (malformed path) before the fact enters composition.
 */
export function validateStructuralFact(registry, fact) {
  const dimension = requireString(fact.dimension, 'dimension')
  const operationKey = requireString(fact.operationKey, 'operationKey')
  const path = normalizeRelativePath(requireString(fact.path, 'path'))
  const definition = registry.get(operationKey)
  const normalized = { kind: 'structural', dimension, path, operationKey, params: fact.params }
  assertParamsAccepted(definition, normalized)
  return normalized
}

export function validateStructuralFacts(registry, rawFacts) {
  return rawFacts.map((fact) => validateStructuralFact(registry, fact))
}
