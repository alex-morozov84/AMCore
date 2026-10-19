/**
 * A correlation ID is a search key in the log store and travels inside queued job envelopes,
 * so its format is bounded: one string, 1-128 characters from a log-safe set. It is a search
 * aid only: any client can send any well-formed value, so it never proves who made a request.
 */
export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

/** Response header carrying the ID; the web server already sends the same name outbound. */
export const CORRELATION_ID_HEADER = 'X-Correlation-Id'

export function isCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && CORRELATION_ID_PATTERN.test(value)
}

/**
 * Picks the first inbound header value that is a well-formed correlation ID, in the given
 * priority order. A repeated header (array), an oversized or oddly encoded value is skipped
 * without being logged; `generate` supplies the ID when nothing usable arrives.
 */
export function pickCorrelationId(
  candidates: readonly (string | string[] | undefined)[],
  generate: () => string
): string {
  for (const candidate of candidates) if (isCorrelationId(candidate)) return candidate
  return generate()
}
