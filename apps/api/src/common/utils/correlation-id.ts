import { CORRELATION_ID_PATTERN, isCorrelationId } from '@amcore/shared'

/** Response header carrying the ID; the web server already sends the same name outbound. */
export const CORRELATION_ID_HEADER = 'X-Correlation-Id'

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

export { CORRELATION_ID_PATTERN, isCorrelationId }
