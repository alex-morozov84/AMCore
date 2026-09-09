import { logPrimaryUnavailable } from '@/shared/lib/server-logger'

import type { DataOutcome, UnavailableReason } from './types'

import 'server-only'

/**
 * A primary section's render state. Unlike the earlier throw-based design
 * (see `ai/models-talk.md`'s PR1 second review round), a *known*
 * availability failure is never thrown - it is an ordinary, expected
 * outcome the Server Component branches on directly, the same way
 * `degrade-secondary.ts`'s `SecondaryRenderOutcome` already works. This
 * sidesteps the "does a thrown error's fields survive to a client
 * fallback" problem entirely: nothing crosses an error boundary for the
 * known case, so there is nothing that can be lost in transit, and no
 * double-logging risk to guard against. `catchError`/`instrumentation.ts`'s
 * `onRequestError` are reserved for genuinely unexpected exceptions only.
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
