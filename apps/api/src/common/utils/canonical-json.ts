import { createHash } from 'node:crypto'

/**
 * Deterministic JSON text for identity comparison: object keys are sorted at every depth, array order
 * is preserved, `undefined` object members are dropped (as `JSON.stringify` does). Two values that are
 * structurally equal serialize to the same text regardless of key insertion order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

/** sha256 (hex) of the canonical JSON text — a compact, stable fingerprint of a JSON-like value. */
export function canonicalJsonHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

/** Structural equality of two JSON-like values under the canonical form. */
export function canonicalJsonEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .filter((key) => source[key] !== undefined)
        .map((key) => [key, sortKeys(source[key])])
    )
  }
  return value
}
