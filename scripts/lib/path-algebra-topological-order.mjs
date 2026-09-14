// Deterministic topological ordering of materialized operations for the
// path algebra (BACKLOG item 14, PR2/M1, FINAL PLAN §2.1). Extraction edges
// (a move that must precede the ancestor delete it was rescued out of) are
// the only ordering constraint — everything else sorts by key, so the
// result never depends on input fact order.
function keyOf(op) {
  return op.kind === 'move' ? op.from : op.target
}

function buildDependencyGraph(operations, extractionEdges) {
  const byKey = new Map(operations.map((op) => [keyOf(op), op]))
  const inDegree = new Map(operations.map((op) => [keyOf(op), 0]))
  const dependents = new Map()
  for (const { moveSource, ancestorDir } of extractionEdges) {
    if (!byKey.has(moveSource) || !byKey.has(ancestorDir)) continue
    inDegree.set(ancestorDir, inDegree.get(ancestorDir) + 1)
    if (!dependents.has(moveSource)) dependents.set(moveSource, [])
    dependents.get(moveSource).push(ancestorDir)
  }
  return { byKey, inDegree, dependents }
}

function insertSorted(queue, key) {
  const index = queue.findIndex((existing) => existing > key)
  if (index === -1) queue.push(key)
  else queue.splice(index, 0, key)
}

/**
 * Orders `operations` so every extraction (a move rescuing content out of a
 * directory another operation deletes) precedes that deletion. Ties broken
 * by sorted key — the result is fully deterministic and independent of the
 * order `operations`/`extractionEdges` were built in.
 */
export function topologicalOrder(operations, extractionEdges) {
  const { byKey, inDegree, dependents } = buildDependencyGraph(operations, extractionEdges)
  const ready = [...inDegree.entries()].filter(([, degree]) => degree === 0).map(([key]) => key).sort()
  const orderedKeys = []

  while (ready.length > 0) {
    const key = ready.shift()
    orderedKeys.push(key)
    for (const dependent of dependents.get(key) ?? []) {
      inDegree.set(dependent, inDegree.get(dependent) - 1)
      if (inDegree.get(dependent) === 0) insertSorted(ready, dependent)
    }
  }

  return orderedKeys.map((key) => byKey.get(key))
}
