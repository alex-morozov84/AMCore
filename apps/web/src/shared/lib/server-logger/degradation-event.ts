import { getServerLogger } from './logger'
import { checkSuppression } from './suppression'

import 'server-only'

const SUPPRESSION_WINDOW_MS = 60_000

/**
 * The bounded field set a degradation log line may ever carry. Deliberately
 * closed — no `headers`/`query`/`body`/raw-error fields, matching
 * `ai/LOGGING.md`'s existing "bounded" discipline. The type itself is the
 * allowlist: a caller cannot pass an unbounded field even by mistake.
 */
export interface DegradationEvent {
  /** e.g. `'secondary_data_degraded'` — stable, not interpolated. */
  event: string
  /** A bounded identifier for what degraded, e.g. `'queue-backlog-panel'` —
   *  never a raw path/query string. */
  source: string
  reason: 'rate-limited' | 'timeout' | 'network' | 'upstream'
  retryAfterMs?: number
  correlationId?: string
}

/**
 * Logs exactly once per `event:source` per `SUPPRESSION_WINDOW_MS` — a
 * dependency that's down for the whole window must not turn into one log
 * line per page view (`ai/models-talk.md` §7).
 */
export function logDegradation(fields: DegradationEvent): void {
  const key = `${fields.event}:${fields.source}`
  const { shouldLog, suppressedSinceLastLog } = checkSuppression(key, SUPPRESSION_WINDOW_MS)
  if (!shouldLog) return

  const record = suppressedSinceLastLog > 0 ? { ...fields, suppressedSinceLastLog } : fields
  getServerLogger().warn(record, 'degraded_data')
}
