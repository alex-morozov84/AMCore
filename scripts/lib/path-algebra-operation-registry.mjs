// Central operation registry for structural composition (BACKLOG item 14,
// PR2/M2, FINAL PLAN §2.2). A factory, not a module-level singleton — each
// caller (production wiring, later; each test, now) owns an isolated
// registry, so registrations never leak between tests sharing this module.
import { PathAlgebraConflictError, CONFLICT_CODES } from './path-algebra-errors.mjs'

function definitionError(key, detail) {
  return new PathAlgebraConflictError(CONFLICT_CODES.INVALID_OPERATION_DEFINITION, {
    paths: [],
    dimensions: [],
    detail: `operationKey "${key}": ${detail}`,
  })
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

/**
 * Rejects a malformed definition at registration time, so a definition bug
 * is diagnosed where it is written — never first surfacing as a `TypeError`
 * deep inside planning or adapter application.
 */
function validateDefinition(key, definition) {
  if (!isNonEmptyString(key))
    throw definitionError(String(key), 'operationKey must be a non-empty string')
  if (definition === null || typeof definition !== 'object')
    throw definitionError(key, 'definition must be an object')
  for (const field of ['paramsSchema', 'deriveSemanticWrites', 'adapter']) {
    if (typeof definition[field] !== 'function')
      throw definitionError(key, `"${field}" must be a function`)
  }
  const dependsOn = definition.dependsOn ?? []
  if (!Array.isArray(dependsOn) || !dependsOn.every(isNonEmptyString)) {
    throw definitionError(key, '"dependsOn" must be an array of non-empty operationKey strings')
  }
  if (dependsOn.includes(key))
    throw definitionError(key, '"dependsOn" must not name the operation itself')
  return { key, ...definition, dependsOn: [...dependsOn] }
}

/**
 * One `operationKey` binds to exactly one definition:
 * - `paramsSchema(params) => boolean` — validates params; never trusted
 *   without this check. A throw is reported as `INVALID_OPERATION_PARAMS`.
 * - `deriveSemanticWrites(params) => [{ location, value }, ...]` — must
 *   return a non-empty array of well-formed claims for any params
 *   `paramsSchema` accepts; enforced mechanically at planning time (§2.2).
 * - `dependsOn` — other registered `operationKey`s this one must apply
 *   after, when both target the same path. Optional, defaults to `[]`.
 * - `adapter(model, params, ctx) => void` — records structural edits on the
 *   shared per-file model; call sites never supply their own adapter, only a
 *   key and params. Parsing and serialization belong to the orchestrator.
 */
export function createOperationRegistry() {
  const definitions = new Map()

  function define(key, definition) {
    const validated = validateDefinition(key, definition)
    if (definitions.has(key)) {
      throw new PathAlgebraConflictError(CONFLICT_CODES.DUPLICATE_OPERATION_DEFINITION, {
        paths: [],
        dimensions: [],
        detail: `operationKey "${key}" is already registered — a key binds to exactly one definition`,
      })
    }
    definitions.set(key, validated)
  }

  function get(key) {
    const definition = definitions.get(key)
    if (!definition) {
      throw new PathAlgebraConflictError(CONFLICT_CODES.UNKNOWN_OPERATION_KEY, {
        paths: [],
        dimensions: [],
        detail: `operationKey "${key}" is not registered`,
      })
    }
    return definition
  }

  return registryApi(definitions, define, get)
}

function registryApi(definitions, define, get) {
  return {
    define,
    get,
    has: (key) => definitions.has(key),
    keys: () => [...definitions.keys()].sort(),
  }
}
