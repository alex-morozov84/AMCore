// Structural operation composition (BACKLOG item 14, PR2/M2, FINAL PLAN
// §2.2) — the orchestrator tying the registry, same-key dedup, semantic-
// write conflict detection, dependency ordering and adapter application
// together.
import { validateStructuralFacts } from './path-algebra-structural-facts.mjs'
import { dedupeByOperationKey } from './path-algebra-operation-dedup.mjs'
import {
  deriveSemanticWrites,
  assertNoSemanticWriteConflicts,
} from './path-algebra-semantic-writes.mjs'
import { orderOperationKeys } from './path-algebra-operation-order.mjs'
import { parseStructuralModel, serializeStructuralModel } from './path-algebra-ast-model.mjs'
import { PathAlgebraConflictError, CONFLICT_CODES } from './path-algebra-errors.mjs'

function groupByPath(facts) {
  const byPath = new Map()
  for (const fact of facts) {
    if (!byPath.has(fact.path)) byPath.set(fact.path, [])
    byPath.get(fact.path).push(fact)
  }
  return byPath
}

function planOnePath(registry, path, factsForPath) {
  const deduped = dedupeByOperationKey(factsForPath)
  const writesByKey = new Map(
    deduped.map((fact) => [fact.operationKey, deriveSemanticWrites(registry, fact)])
  )
  assertNoSemanticWriteConflicts(deduped, writesByKey)
  const order = orderOperationKeys(
    registry,
    deduped.map((fact) => fact.operationKey)
  )
  return { path, deduped: new Map(deduped.map((fact) => [fact.operationKey, fact])), order }
}

/**
 * Validates and plans structural composition for every path touched by
 * `rawFacts`, without applying any adapter. Fails closed (throws) before any
 * filesystem mutation on: unknown operation keys, invalid params, same-key
 * param conflicts, malformed or conflicting semantic claims, unknown/missing
 * dependencies, and dependency cycles. Returns one plan per path, path-sorted.
 */
export function planStructuralComposition(registry, rawFacts) {
  const facts = validateStructuralFacts(registry, rawFacts)
  const byPath = groupByPath(facts)
  return [...byPath.keys()].sort().map((path) => planOnePath(registry, path, byPath.get(path)))
}

function adapterError(plan, operationKey, detail) {
  return new PathAlgebraConflictError(CONFLICT_CODES.INVALID_OPERATION_DEFINITION, {
    paths: [plan.path],
    dimensions: [],
    detail: `operationKey "${operationKey}" adapter ${detail}`,
  })
}

/**
 * An adapter edits the shared model in place. A returned value means it
 * built its own representation instead; an exception that is not a path
 * algebra diagnostic (a `TypeError` from a defective adapter) is reported
 * as one, with its message, rather than escaping raw. Structured
 * diagnostics (missing/ambiguous node, ...) pass through unchanged.
 */
function runAdapter(registry, model, plan, operationKey) {
  const { params } = plan.deduped.get(operationKey)
  let returned
  try {
    returned = registry.get(operationKey).adapter(model, params, { path: plan.path, operationKey })
  } catch (error) {
    if (error instanceof PathAlgebraConflictError) throw error
    throw adapterError(plan, operationKey, `threw "${error?.message ?? String(error)}"`)
  }
  if (returned !== undefined) {
    throw adapterError(
      plan,
      operationKey,
      'returned a value — adapters record edits on the shared model'
    )
  }
}

/**
 * Applies one path's plan to `initialText`: parses it exactly once into the
 * shared structural model, runs each operation's adapter against that same
 * model in dependency order, then validates and serializes once. Every
 * failure — input that does not parse, a missing/ambiguous semantic node,
 * overlapping edits, output that does not parse — throws before this
 * function returns text, so a caller can never write a broken result
 * (this function performs no I/O itself).
 */
export function applyStructuralPlan(registry, plan, initialText) {
  const model = parseStructuralModel(plan.path, initialText)
  for (const operationKey of plan.order) runAdapter(registry, model, plan, operationKey)
  return serializeStructuralModel(model)
}
