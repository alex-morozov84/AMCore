import type { UnavailableReason } from './types'

/**
 * Classify a non-OK HTTP status from `apps/api` into the closed
 * `DataOutcome` vocabulary. Mirrors `docs/frontend/api-consumption.md`'s
 * existing browser retry policy (only `429` is retryable among 4xx),
 * extended here for symmetry to `5xx`/timeout/network on the server side.
 *
 * `'rejected'` covers every other 4xx (`400`, `401`, `403`, `409`, `422`,
 * ...) — a real application/auth/contract error, not an infra hiccup. It is
 * deliberately **not** part of `UnavailableReason`: a caller must not offer
 * a "try again" for a request that will fail the same way every time.
 */
export function classifyStatus(status: number): 'not-found' | UnavailableReason | 'rejected' {
  if (status === 404) return 'not-found'
  if (status === 429) return 'rate-limited'
  if (status >= 500) return 'upstream'
  return 'rejected'
}

/**
 * Classify a value `fetch()` itself threw (never reached a response) into a
 * known transient reason, or `null` when it isn't one of the recognized
 * shapes. Returning `null` is deliberate: an unrecognized thrown value must
 * propagate to the caller (and from there to a real error boundary /
 * `onRequestError`), never get silently absorbed into "the network is down."
 *
 * - `AbortSignal.timeout()` rejects with a `DOMException` named
 *   `'TimeoutError'` — Node/undici's documented shape.
 * - A dropped connection / DNS failure / refused connection surfaces as a
 *   `TypeError` from `fetch()` itself (undici's own failure shape, matching
 *   `http-client.ts`'s existing `ApiNetworkError` classification).
 */
export function classifyThrown(error: unknown): UnavailableReason | null {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'timeout'
  if (error instanceof Error && error.name === 'AbortError') return 'timeout'
  if (error instanceof TypeError) return 'network'
  return null
}
