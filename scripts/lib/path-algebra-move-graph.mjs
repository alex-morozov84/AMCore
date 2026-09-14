// Move-graph construction, chain resolution, and cycle/destination-conflict
// detection for the path algebra (BACKLOG item 14, PR2/M1, FINAL PLAN §2.1).
import { PathAlgebraConflictError, CONFLICT_CODES } from './path-algebra-errors.mjs'

function dedupeSources(moveFacts) {
  const bySource = new Map()
  for (const fact of moveFacts) {
    const existing = bySource.get(fact.from)
    if (!existing) {
      bySource.set(fact.from, { to: fact.to, dimensions: new Set([fact.dimension]) })
      continue
    }
    if (existing.to === fact.to) {
      existing.dimensions.add(fact.dimension)
      continue
    }
    throw new PathAlgebraConflictError(CONFLICT_CODES.MOVE_DESTINATION_MISMATCH, {
      paths: [fact.from, existing.to, fact.to],
      dimensions: [...existing.dimensions, fact.dimension],
      detail: `move source "${fact.from}" has two different declared destinations`,
    })
  }
  return bySource
}

function assertNoCompetingDestinations(bySource) {
  const byDestination = new Map()
  for (const [from, { to }] of bySource) {
    if (!byDestination.has(to)) byDestination.set(to, new Set())
    byDestination.get(to).add(from)
  }
  for (const [to, sources] of byDestination) {
    if (sources.size <= 1) continue
    const dims = [...sources].flatMap((from) => [...bySource.get(from).dimensions])
    throw new PathAlgebraConflictError(CONFLICT_CODES.COMPETING_MOVE_DESTINATION, {
      paths: [to, ...sources],
      dimensions: dims,
      detail: `move destination "${to}" is claimed by multiple different sources`,
    })
  }
}

function throwCycle(bySource, stack, current) {
  const cycle = stack.slice(stack.indexOf(current))
  throw new PathAlgebraConflictError(CONFLICT_CODES.MOVE_CYCLE, {
    paths: cycle,
    dimensions: cycle.flatMap((p) => [...bySource.get(p).dimensions]),
    detail: `move chain forms a cycle: ${cycle.join(' -> ')}`,
  })
}

function walkChain(bySource, state, start) {
  const stack = []
  let current = start
  while (bySource.has(current)) {
    if (state.get(current) === 'visiting') throwCycle(bySource, stack, current)
    state.set(current, 'visiting')
    stack.push(current)
    current = bySource.get(current).to
  }
  for (const path of stack) state.set(path, 'done')
}

function assertAcyclic(bySource) {
  const state = new Map()
  for (const start of bySource.keys()) {
    if (state.get(start) !== 'done') walkChain(bySource, state, start)
  }
}

/**
 * Builds and validates the move graph from every `move` fact. Throws a
 * `PathAlgebraConflictError` for a destination mismatch, a competing
 * destination, or a cycle — all detected before any chain is resolved.
 * Deduplicates identical `from -> to` declarations from different
 * dimensions into one edge.
 */
export function buildMoveGraph(moveFacts) {
  const bySource = dedupeSources(moveFacts)
  assertNoCompetingDestinations(bySource)
  assertAcyclic(bySource)
  const destinations = new Set([...bySource.values()].map(({ to }) => to))
  return {
    isSource: (path) => bySource.has(path),
    rootSources: () => [...bySource.keys()].filter((source) => !destinations.has(source)).sort(),
    dimensionsOf: (source) => [...(bySource.get(source)?.dimensions ?? [])],
    /** Follows the (already-validated-acyclic) chain from `source` to its final destination. */
    finalDestinationOf(source) {
      let current = source
      while (bySource.has(current)) current = bySource.get(current).to
      return current
    },
  }
}
