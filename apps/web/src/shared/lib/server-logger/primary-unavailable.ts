import { getServerLogger } from './logger'
import { normalizeSource } from './source'
import { checkSuppression } from './suppression'

import 'server-only'

const SUPPRESSION_WINDOW_MS = 60_000

/**
 * The bounded field set for a *known* primary-content availability failure
 * - logged by `shared/api/server/resolve-primary.ts` at the point it
 * resolves the failure, server-side. Primary unavailability is an ordinary
 * render-time outcome, never thrown, so this is a plain log-then-return -
 * no error boundary, no RSC serialization, and no dependency on any field
 * surviving a transport it never crosses.
 */
export interface LogPrimaryUnavailableInput {
  source: string
  reason: 'rate-limited' | 'timeout' | 'network' | 'upstream'
  retryAfterMs?: number
  correlationId?: string
}

export function logPrimaryUnavailable(input: LogPrimaryUnavailableInput): void {
  const source = normalizeSource(input.source)
  const key = `primary_data_unavailable:${source}`
  const { shouldLog, suppressedSinceLastLog, globalOverflowSuppressedSinceLastLog } =
    checkSuppression(key, SUPPRESSION_WINDOW_MS)
  if (!shouldLog) return

  getServerLogger().error(
    {
      event: 'primary_data_unavailable',
      source,
      reason: input.reason,
      retryAfterMs: input.retryAfterMs,
      correlationId: input.correlationId?.slice(0, 64),
      ...(suppressedSinceLastLog > 0 ? { suppressedSinceLastLog } : {}),
      ...(globalOverflowSuppressedSinceLastLog > 0 ? { globalOverflowSuppressedSinceLastLog } : {}),
    },
    'primary_data_unavailable'
  )
}
