import { logPrimaryUnavailable } from '@/shared/lib/server-logger'

import type { DataOutcome, UnavailableReason } from './types'

import 'server-only'

/**
 * Thrown by `requirePrimary()` for a known availability failure - caught by
 * `shared/ui/section-error-boundary.tsx`'s `catchError` boundary (PR2).
 * Carries no field the boundary's fallback is allowed to read: a caught
 * error's fields are not guaranteed to survive unchanged from a Server
 * Component to a client fallback (verified empirically against this
 * project's installed Next version - see the ADR-079 record). `status`/
 * `correlationId`/`isPrimaryUnavailableError` exist for server-side use
 * only, never for UI presentation.
 *
 * `requirePrimary()` already logs this exactly once, server-side, at the
 * moment it throws - see `logPrimaryUnavailable()`. `isPrimaryUnavailableError`
 * lets `instrumentation.ts`'s `onRequestError` recognize and skip an
 * already-logged instance, best-effort (the same "might not be the original
 * instance" caveat applies there too).
 */
export class PrimaryUnavailableError extends Error {
  readonly isPrimaryUnavailableError = true as const

  constructor(
    public readonly reason: UnavailableReason,
    public readonly retryAfterMs?: number,
    public readonly correlationId?: string
  ) {
    super(`primary content unavailable (${reason})`)
    this.name = 'PrimaryUnavailableError'
  }
}

export function isPrimaryUnavailableError(error: unknown): boolean {
  return (
    error instanceof PrimaryUnavailableError ||
    (typeof error === 'object' &&
      error !== null &&
      'isPrimaryUnavailableError' in error &&
      (error as { isPrimaryUnavailableError: unknown }).isPrimaryUnavailableError === true)
  )
}

export interface RequirePrimaryContext {
  /** A short identifier for the section, e.g. `'product-detail'` - never a
   *  raw path/query string. */
  source: string
}

/**
 * Unwraps a primary-content `DataOutcome` for a section error boundary to
 * catch. Deliberately does **not** handle `'not-found'` - only the caller
 * knows whether this fetch is the route's authoritative resource lookup;
 * call Next's `notFound()` explicitly at that call site instead, before any
 * Suspense boundary. Passing a `'not-found'` outcome here is a caller
 * mistake and throws loudly rather than guessing.
 */
export function requirePrimary<T>(outcome: DataOutcome<T>, context: RequirePrimaryContext): T {
  if (outcome.status === 'success') return outcome.data

  if (outcome.status === 'not-found') {
    throw new Error(
      "requirePrimary: got a 'not-found' outcome - if this is the route's authoritative " +
        'resource lookup, call notFound() explicitly at the call site instead.'
    )
  }

  logPrimaryUnavailable({
    source: context.source,
    reason: outcome.reason,
    retryAfterMs: outcome.retryAfterMs,
    correlationId: outcome.correlationId,
  })
  throw new PrimaryUnavailableError(outcome.reason, outcome.retryAfterMs, outcome.correlationId)
}
