// Central operation registry for structural composition (BACKLOG item 14,
// PR2/M2, FINAL PLAN §2.2). A factory, not a module-level singleton — each
// caller (production wiring, later; each test, now) owns an isolated
// registry, so registrations never leak between tests sharing this module.
import { PathAlgebraConflictError, CONFLICT_CODES } from './path-algebra-errors.mjs'

/**
 * One `operationKey` binds to exactly one definition:
 * - `paramsSchema(params) => boolean` — validates params; never trusted
 *   without this check.
 * - `deriveSemanticWrites(params) => [{ location, value }, ...]` — must
 *   return a non-empty array for any params `paramsSchema` accepts; this is
 *   mechanically enforced at registration-use time (§2.2), not left to the
 *   author's convention.
 * - `dependsOn` — an array of other registered `operationKey`s this one
 *   must apply after, when both target the same path.
 * - `adapter(representation, params) => representation` — a pure function;
 *   call sites never supply their own adapter, only a key and params.
 */
export function createOperationRegistry() {
  const definitions = new Map()

  function define(key, { paramsSchema, deriveSemanticWrites, dependsOn = [], adapter }) {
    if (definitions.has(key)) {
      throw new PathAlgebraConflictError(CONFLICT_CODES.DUPLICATE_OPERATION_DEFINITION, {
        paths: [],
        dimensions: [],
        detail: `operationKey "${key}" is already registered — a key binds to exactly one definition`,
      })
    }
    definitions.set(key, { key, paramsSchema, deriveSemanticWrites, dependsOn, adapter })
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

  return { define, get, has: (key) => definitions.has(key) }
}
