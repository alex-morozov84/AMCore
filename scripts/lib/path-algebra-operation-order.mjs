// Deterministic ordering of the operation keys composing one path (BACKLOG
// item 14, PR2/M2, FINAL PLAN §2.2). Dependency metadata lives on the
// registry definition, never on a call-site fact, so it cannot vary between
// duplicate facts for the same key. `operationKey` is the tie-breaker, so
// order never depends on registration order, fact order, or CLI-flag order.
import { PathAlgebraConflictError, CONFLICT_CODES } from './path-algebra-errors.mjs'

function dependencyError(code, key, dependency, reason) {
  return new PathAlgebraConflictError(code, {
    paths: [],
    dimensions: [],
    detail: `operationKey "${key}" depends on "${dependency}", which ${reason}`,
  })
}

/**
 * A dependency must be a registered key (else the definition is wrong:
 * `UNKNOWN_OPERATION_DEPENDENCY`) *and* part of this path's active set
 * (else the call site is incomplete: `MISSING_OPERATION_DEPENDENCY`).
 */
function assertDependenciesPresent(registry, activeKeys) {
  const active = new Set(activeKeys)
  for (const key of activeKeys) {
    for (const dependency of registry.get(key).dependsOn) {
      if (active.has(dependency)) continue
      if (!registry.has(dependency)) {
        throw dependencyError(
          CONFLICT_CODES.UNKNOWN_OPERATION_DEPENDENCY,
          key,
          dependency,
          'is not a registered operation'
        )
      }
      throw dependencyError(
        CONFLICT_CODES.MISSING_OPERATION_DEPENDENCY,
        key,
        dependency,
        'is not part of this composition'
      )
    }
  }
}

function insertSorted(queue, key) {
  const index = queue.findIndex((existing) => existing > key)
  if (index === -1) queue.push(key)
  else queue.splice(index, 0, key)
}

function buildDependencyGraph(registry, activeKeys) {
  const inDegree = new Map(activeKeys.map((key) => [key, 0]))
  const dependents = new Map()
  for (const key of activeKeys) {
    for (const dependency of registry.get(key).dependsOn) {
      inDegree.set(key, inDegree.get(key) + 1)
      if (!dependents.has(dependency)) dependents.set(dependency, [])
      dependents.get(dependency).push(key)
    }
  }
  return { inDegree, dependents }
}

function runKahn({ inDegree, dependents }) {
  const ready = [...inDegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([key]) => key)
    .sort()
  const ordered = []
  while (ready.length > 0) {
    const key = ready.shift()
    ordered.push(key)
    for (const dependent of dependents.get(key) ?? []) {
      inDegree.set(dependent, inDegree.get(dependent) - 1)
      if (inDegree.get(dependent) === 0) insertSorted(ready, dependent)
    }
  }
  return ordered
}

/**
 * Topologically orders `activeKeys` per their registered `dependsOn`
 * edges, breaking ties (and ordering every key with no dependency at all)
 * by lexicographic key. Throws `UNKNOWN_OPERATION_DEPENDENCY` for an
 * unregistered dependency, `MISSING_OPERATION_DEPENDENCY` for a registered
 * one outside the active set, or `OPERATION_DEPENDENCY_CYCLE` for a cycle
 * among the active keys.
 */
export function orderOperationKeys(registry, activeKeys) {
  assertDependenciesPresent(registry, activeKeys)
  const ordered = runKahn(buildDependencyGraph(registry, activeKeys))
  if (ordered.length !== activeKeys.length) {
    const stuck = activeKeys.filter((key) => !ordered.includes(key)).sort()
    throw new PathAlgebraConflictError(CONFLICT_CODES.OPERATION_DEPENDENCY_CYCLE, {
      paths: [],
      dimensions: [],
      detail: `operation dependency cycle among: ${stuck.join(', ')}`,
    })
  }
  return ordered
}
