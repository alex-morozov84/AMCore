const FACT_KINDS = new Set(['delete', 'move', 'content'])

export class InvalidPathFactError extends Error {
  constructor(index, reason) {
    super(`invalid path-algebra fact at index ${index}: ${reason}`)
    this.index = index
    this.reason = reason
  }
}

function requireString(value, field, index) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidPathFactError(index, `"${field}" must be a non-empty string`)
  }
}

function validateFact(fact, index) {
  if (fact === null || typeof fact !== 'object' || Array.isArray(fact)) {
    throw new InvalidPathFactError(index, 'must be an object')
  }
  if (!FACT_KINDS.has(fact.kind)) {
    throw new InvalidPathFactError(index, `unsupported kind "${String(fact.kind)}"`)
  }
  requireString(fact.dimension, 'dimension', index)
  if (fact.kind === 'move') {
    requireString(fact.from, 'from', index)
    requireString(fact.to, 'to', index)
  } else {
    requireString(fact.path, 'path', index)
  }
  return fact
}

export function validateFacts(rawFacts) {
  if (!Array.isArray(rawFacts)) {
    throw new InvalidPathFactError(-1, 'fact collection must be an array')
  }
  return rawFacts.map(validateFact)
}
