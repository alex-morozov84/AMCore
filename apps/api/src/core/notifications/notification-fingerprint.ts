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

export interface NotificationFingerprintInput {
  type: string
  category: string
  schemaVersion: number
  payload: unknown
  /** Validated action descriptor (or null) — an immutable field of the canonical row. */
  action: unknown
  /** Immutable canonical context written to the row; part of the dedupe identity. */
  organizationId: string | null
  /** Explicit caller event time as ISO, or null — never a generated default, so a
   *  retry that omits occurredAt still matches a prior one. */
  occurredAt: string | null
}

/**
 * Covers every immutable field persisted on the canonical row (type, category,
 * version, payload, action, org, explicit event time). Preference-resolved channels
 * and locale are deliberately excluded — they are snapshot outcomes, not caller
 * idempotency intent.
 */
export function notificationFingerprint(input: NotificationFingerprintInput): string {
  const canonical = JSON.stringify({
    type: input.type,
    category: input.category,
    schemaVersion: input.schemaVersion,
    organizationId: input.organizationId,
    occurredAt: input.occurredAt,
    action: canonicalize(input.action),
    payload: canonicalize(input.payload),
  })
  return createHash('sha256').update(canonical).digest('hex')
}
