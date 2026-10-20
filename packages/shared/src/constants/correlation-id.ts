/**
 * A correlation ID is a search key in the log store and travels inside queued job envelopes,
 * so its format is bounded: one string, 1-128 characters from a log-safe set. It is a search
 * aid only: any client can send any well-formed value, so it never proves who made a request.
 * The API validates inbound values with it and the Console builds log-search links only for
 * values that match it.
 */
export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

export function isCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && CORRELATION_ID_PATTERN.test(value)
}
