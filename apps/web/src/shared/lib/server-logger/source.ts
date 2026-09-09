import 'server-only'

const MAX_SOURCE_LENGTH = 64
/** A safe, log-line-friendly identifier shape: lowercase, digits, hyphens. */
const SOURCE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

/**
 * Bounds and validates a caller-supplied `source` identifier at the logging
 * boundary - a TypeScript `string` type does not stop a runtime value that
 * bypassed type-checking (plain JS caller, `any`-typed data) from carrying
 * something unbounded or unexpected. An invalid value logs as a fixed,
 * harmless placeholder rather than being rejected outright, so a caller
 * mistake degrades the log line's usefulness, never the caller's own
 * behavior.
 */
export function normalizeSource(source: string): string {
  const truncated = source.slice(0, MAX_SOURCE_LENGTH)
  return SOURCE_PATTERN.test(truncated) ? truncated : 'invalid-source'
}
