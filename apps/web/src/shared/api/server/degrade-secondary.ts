import { logDegradation } from '@/shared/lib/server-logger'

import type { DataOutcome, UnavailableReason } from './types'

import 'server-only'

export interface SecondaryDegradeContext {
  /** A short identifier for the widget, e.g. `'queue-backlog-panel'` -
   *  never a raw path/query string. */
  source: string
}

/**
 * A secondary section's render state, richer than a plain `T | undefined`
 * on purpose: `'degraded'` keeps the `reason`, so a caller can build any of
 * the three policies the origin problem calls for (hidden, disabled with a
 * generic note, or an inline "temporarily unavailable" state) instead of
 * only ever supporting "hide".
 */
export type SecondaryRenderOutcome<T> =
  { status: 'available'; data: T } | { status: 'degraded'; reason: UnavailableReason }

/**
 * Converts a `DataOutcome` into what a secondary section renders. Logs
 * exactly once per degrade (never a silent, unlogged disappearance).
 * Anything else - `'not-found'` from a source that has no such semantics,
 * or a caller passing something outside the closed `DataOutcome` union - is
 * a programming error and throws rather than degrading, matching the
 * "unknown never gets a quiet path" rule this whole module follows.
 */
export function degradeSecondary<T>(
  outcome: DataOutcome<T>,
  context: SecondaryDegradeContext
): SecondaryRenderOutcome<T> {
  if (outcome.status === 'success') return { status: 'available', data: outcome.data }

  if (outcome.status === 'unavailable') {
    logDegradation({
      source: context.source,
      reason: outcome.reason,
      retryAfterMs: outcome.retryAfterMs,
      correlationId: outcome.correlationId,
    })
    return { status: 'degraded', reason: outcome.reason }
  }

  throw new Error(
    `degradeSecondary: "${context.source}" returned 'not-found', which has no silent-degrade ` +
      `meaning for secondary data - handle it explicitly at the call site instead.`
  )
}
