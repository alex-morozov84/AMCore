import { logDegradation } from '@/shared/lib/server-logger'

import type { DataOutcome } from './types'

import 'server-only'

export interface SecondaryDegradeContext {
  /** A bounded identifier for the widget, e.g. `'queue-backlog-panel'` —
   *  never a raw path/query string (`ai/LOGGING.md`'s bounded-fields rule). */
  source: string
}

/**
 * Converts a `DataOutcome` into what a secondary section renders:
 * `data` on success, `undefined` on a *known* availability failure (logged
 * once — never a silent, unlogged disappearance). Anything else — `'not-found'`
 * from a source that has no such semantics, or a caller passing something
 * outside the closed `DataOutcome` union — is a programming error and throws
 * rather than degrading, matching `ai/models-talk.md` §3's "unknown never
 * gets a quiet path" rule.
 */
export function degradeSecondary<T>(
  outcome: DataOutcome<T>,
  context: SecondaryDegradeContext
): T | undefined {
  if (outcome.status === 'success') return outcome.data

  if (outcome.status === 'unavailable') {
    logDegradation({
      event: 'secondary_data_degraded',
      source: context.source,
      reason: outcome.reason,
      retryAfterMs: outcome.retryAfterMs,
      correlationId: outcome.correlationId,
    })
    return undefined
  }

  throw new Error(
    `degradeSecondary: "${context.source}" returned 'not-found', which has no silent-degrade ` +
      `meaning for secondary data - handle it explicitly at the call site instead.`
  )
}
