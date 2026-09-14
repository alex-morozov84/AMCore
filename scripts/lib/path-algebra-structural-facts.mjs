// Validates a `structural` fact against a registry before it enters
// composition (BACKLOG item 14, PR2/M2, FINAL PLAN §2.2). Call sites supply
// only `{ dimension, path, operationKey, params }` — never an adapter.
import { normalizeRelativePath } from './path-algebra-normalize.mjs'
import { PathAlgebraConflictError, CONFLICT_CODES } from './path-algebra-errors.mjs'

function requireString(value, field) {
  return typeof value === 'string' && value.length > 0
    ? value
    : (() => {
        throw new TypeError(`structural fact "${field}" must be a non-empty string`)
      })()
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

  if (!definition.paramsSchema(fact.params)) {
    throw new PathAlgebraConflictError(CONFLICT_CODES.INVALID_OPERATION_PARAMS, {
      paths: [path],
      dimensions: [dimension],
      detail: `operationKey "${operationKey}" rejected its params for "${path}"`,
    })
  }

  return { kind: 'structural', dimension, path, operationKey, params: fact.params }
}

export function validateStructuralFacts(registry, rawFacts) {
  return rawFacts.map((fact) => validateStructuralFact(registry, fact))
}
