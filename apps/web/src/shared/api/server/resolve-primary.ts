import { logPrimaryUnavailable } from '@/shared/lib/server-logger'

import type { DataOutcome, UnavailableReason } from './types'

import 'server-only'

/**
 * A primary section's render state. A *known* availability failure is never
 * thrown: it is an ordinary, expected outcome the Server Component branches
 * on directly, just like `degrade-secondary.ts`'s `SecondaryRenderOutcome`.
 * Nothing crosses an error boundary for the known case, so RSC error
 * serialization cannot discard classification fields or cause a second log.
 * `catchError`/`instrumentation.ts`'s `onRequestError` remain reserved for
 * genuinely unexpected exceptions.
 */
export type PrimaryRenderOutcome<T> =
  | { status: 'available'; data: T }
  | { status: 'unavailable'; reason: UnavailableReason; retryAfterMs?: number }

export interface ResolvePrimaryContext {
  /** A short identifier for the section, e.g. `'product-detail'` - never a
   *  raw path/query string. */
  source: string
}

/**
 * Resolves a primary-content `DataOutcome` into what the Server Component
 * renders. Logs a known unavailability exactly once at this decision
 * point (`logPrimaryUnavailable`), then returns it for the caller to render
 * a localized fallback + retry control directly - no throw, no error
 * boundary involved.
 *
 * Deliberately does **not** handle `'not-found'` - only the caller knows
 * whether this fetch is the route's authoritative resource lookup; call
 * Next's `notFound()` explicitly at that call site instead, before any
 * Suspense boundary. Passing a `'not-found'` outcome here is a caller
 * mistake and throws loudly rather than guessing.
 */
export function resolvePrimary<T>(
  outcome: DataOutcome<T>,
  context: ResolvePrimaryContext
): PrimaryRenderOutcome<T> {
  if (outcome.status === 'success') return { status: 'available', data: outcome.data }

  if (outcome.status === 'not-found') {
    throw new Error(
      "resolvePrimary: got a 'not-found' outcome - if this is the route's authoritative " +
        'resource lookup, call notFound() explicitly at the call site instead.'
    )
  }

  logPrimaryUnavailable({
    source: context.source,
    reason: outcome.reason,
    retryAfterMs: outcome.retryAfterMs,
    correlationId: outcome.correlationId,
  })
  return { status: 'unavailable', reason: outcome.reason, retryAfterMs: outcome.retryAfterMs }
}
