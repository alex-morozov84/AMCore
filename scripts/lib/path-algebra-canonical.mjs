// Stable, order-independent canonical serialization for the path algebra
// (BACKLOG item 14, PR2/M2, FINAL PLAN §2.2) — used to compare operation
// `params` and semantic-write `value`s so two facts requesting the exact
// same thing are recognized as identical regardless of key insertion order.
function sortedClone(value) {
  if (Array.isArray(value)) return value.map(sortedClone)
  if (value === null || typeof value !== 'object') return value
  const sorted = {}
  for (const key of Object.keys(value).sort()) sorted[key] = sortedClone(value[key])
  return sorted
}

/** Deterministic JSON serialization: object keys sorted at every depth, arrays kept in order. */
export function canonicalStringify(value) {
  return JSON.stringify(sortedClone(value))
}
