import { createHash } from 'node:crypto'

/**
 * Deterministic content fingerprint for idempotent notification creation (ADR-052).
 *
 * On an idempotency-key conflict the producer compares fingerprints: a matching one
 * is a safe replay (return the existing row), a different one is a key-reuse error.
 * Object keys are sorted recursively so the hash is independent of property order.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) sorted[key] = canonicalize(source[key])
    return sorted
  }
  return value
}

export function notificationFingerprint(
  type: string,
  schemaVersion: number,
  payload: unknown
): string {
  const canonical = JSON.stringify({ type, schemaVersion, payload: canonicalize(payload) })
  return createHash('sha256').update(canonical).digest('hex')
}
