import type { DataOutcome, UnavailableReason } from './types'

/**
 * Thrown by `requirePrimary()` for a known availability failure — caught by
 * `shared/ui/section-error-boundary.tsx`'s `catchError` boundary. Carries no
 * field the boundary's fallback is allowed to read (`ai/models-talk.md` §6):
 * these exist for server-side logging (`onRequestError`), not UI text.
 */
export class PrimaryUnavailableError extends Error {
  constructor(
    public readonly reason: UnavailableReason,
    public readonly retryAfterMs?: number,
    public readonly correlationId?: string
  ) {
    super(`primary content unavailable (${reason})`)
    this.name = 'PrimaryUnavailableError'
  }
}

/**
 * Unwraps a primary-content `DataOutcome` for a section error boundary to
 * catch. Deliberately does **not** handle `'not-found'` — only the caller
 * knows whether this fetch is the route's authoritative resource lookup;
 * call Next's `notFound()` explicitly at that call site instead, before any
 * Suspense boundary (`ai/models-talk.md` §2). Passing a `'not-found'`
 * outcome here is a caller mistake and throws loudly rather than guessing.
 */
export function requirePrimary<T>(outcome: DataOutcome<T>): T {
  if (outcome.status === 'success') return outcome.data
  if (outcome.status === 'not-found') {
    throw new Error(
      "requirePrimary: got a 'not-found' outcome - if this is the route's authoritative " +
        'resource lookup, call notFound() explicitly at the call site instead.'
    )
  }
  throw new PrimaryUnavailableError(outcome.reason, outcome.retryAfterMs, outcome.correlationId)
}
