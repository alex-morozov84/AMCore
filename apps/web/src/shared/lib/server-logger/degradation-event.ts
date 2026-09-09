import { getServerLogger } from './logger'
import { normalizeSource } from './source'
import { checkSuppression } from './suppression'

import 'server-only'

const SUPPRESSION_WINDOW_MS = 60_000

/**
 * The bounded field set a secondary-data degradation log line may ever
 * carry. Deliberately no `headers`/`query`/`body`/raw-error fields, and no
 * caller-supplied `event` name - the event string itself is owned by
 * `logDegradation()` below, not accepted as input, so a caller can never
 * widen what gets logged just by passing a different value.
 */
export interface LogDegradationInput {
  /** A short identifier for the widget, e.g. `'queue-backlog-panel'` -
   *  normalized and length-capped before it ever reaches the logger; never
   *  a raw path/query string. */
  source: string
  reason: 'rate-limited' | 'timeout' | 'network' | 'upstream'
  retryAfterMs?: number
  correlationId?: string
}

/**
 * Logs exactly once per `source` per `SUPPRESSION_WINDOW_MS`, and is itself
 * subject to a global per-window line cap shared with every other bounded
 * logger in this directory (`checkSuppression`'s `globalOverflowSuppressedSinceLastLog`)
 * - a dependency that's down for the whole window, or one producing many
 * distinct `source` values, cannot turn into unbounded log volume either
 * way.
 */
export function logDegradation(input: LogDegradationInput): void {
  const source = normalizeSource(input.source)
  const key = `secondary_data_degraded:${source}`
  const { shouldLog, suppressedSinceLastLog, globalOverflowSuppressedSinceLastLog } =
    checkSuppression(key, SUPPRESSION_WINDOW_MS)
  if (!shouldLog) return

  getServerLogger().warn(
    {
      event: 'secondary_data_degraded',
      source,
      reason: input.reason,
      retryAfterMs: input.retryAfterMs,
      correlationId: input.correlationId?.slice(0, 64),
      ...(suppressedSinceLastLog > 0 ? { suppressedSinceLastLog } : {}),
      ...(globalOverflowSuppressedSinceLastLog > 0 ? { globalOverflowSuppressedSinceLastLog } : {}),
    },
    'degraded_data'
  )
}
