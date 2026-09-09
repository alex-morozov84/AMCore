/**
 * Parse a `Retry-After` header (RFC 9110 §10.2.3). AMCore's own global
 * rate-limit guard only ever emits the delay-seconds form (a non-negative
 * integer), never the HTTP-date form, so that's the only shape parsed here
 * — an HTTP-date value (or anything else non-numeric) is intentionally
 * ignored rather than guessed at.
 *
 * Shared between the browser BFF client (`http-client.ts`) and the direct
 * server-to-`apps/api` transport (`server/backend-fetch.ts`) so both read
 * the same header the same way instead of two copies drifting apart.
 */
export function parseRetryAfterSeconds(headers: Headers): number | undefined {
  const raw = headers.get('Retry-After')
  if (raw === null) return undefined
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}
