// Structural operation composition (BACKLOG item 14, PR2/M2, FINAL PLAN
// §2.2) — the orchestrator tying the registry, same-key dedup, semantic-
// write conflict detection, dependency ordering and adapter application
// together. Additive only: nothing here is imported by, or imports from,
// the existing engine (init-engine.mjs, plan-steps.mjs, actions.mjs,
// project-init-plan.mjs, any project-plan-*.mjs).
import { validateStructuralFacts } from './path-algebra-structural-facts.mjs'
import { dedupeByOperationKey } from './path-algebra-operation-dedup.mjs'
import { deriveSemanticWrites, assertNoSemanticWriteConflicts } from './path-algebra-semantic-writes.mjs'
import { orderOperationKeys } from './path-algebra-operation-order.mjs'

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
  const writesByKey = new Map(deduped.map((fact) => [fact.operationKey, deriveSemanticWrites(registry, fact)]))
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
 * param conflicts, cross-key semantic conflicts, missing dependencies, and
 * dependency cycles. Returns one plan per path, in path-sorted order.
 */
export function planStructuralComposition(registry, rawFacts) {
  const facts = validateStructuralFacts(registry, rawFacts)
  const byPath = groupByPath(facts)
  return [...byPath.keys()].sort().map((path) => planOnePath(registry, path, byPath.get(path)))
}

/**
 * Applies one path's plan to `initialRepresentation` — the single shared
 * in-memory representation for that path — running each operation's adapter
 * once, in dependency order, threading the representation through so every
 * operation composes onto the previous one's result. A parse/anchor failure
 * from an adapter (`MISSING_ANCHOR`/`AMBIGUOUS_ANCHOR`/`INVALID_OUTPUT_PARSE`)
 * propagates as-is — planning already ran, so this is the only remaining way
 * composition can fail, and it still fails before any file is written by the
 * caller (this function performs no I/O itself).
 */
export function applyStructuralPlan(registry, plan, initialRepresentation) {
  let representation = initialRepresentation
  for (const operationKey of plan.order) {
    const fact = plan.deduped.get(operationKey)
    const definition = registry.get(operationKey)
    representation = definition.adapter(representation, fact.params, { path: plan.path, operationKey })
  }
  return representation
}
