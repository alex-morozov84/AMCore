/**
 * A known, retryable-ish availability failure — the only class a secondary
 * section may degrade silently for (see `degrade-secondary.ts`). `401`/`403`
 * (auth/access) and any other 4xx (a real contract/input error, not an infra
 * hiccup) are deliberately excluded — see `classify.ts`.
 */
export type UnavailableReason = 'rate-limited' | 'timeout' | 'network' | 'upstream'

/**
 * The result of a direct server-to-`apps/api` fetch (`backend-fetch.ts`).
 * Closed and discriminated on purpose: a `2xx` becomes `'success'` only
 * after passing the caller's Zod schema, so a malformed payload can never be
 * mistaken for a valid empty state. `'not-found'` is only produced for an
 * authoritative single-resource lookup that got a real `404` — the caller
 * decides what that means (usually `notFound()`), this type does not.
 */
export type DataOutcome<T> =
  | { status: 'success'; data: T }
  | { status: 'not-found' }
  | {
      status: 'unavailable'
      reason: UnavailableReason
      retryAfterMs?: number
      correlationId?: string
    }
