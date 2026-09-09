import { getServerLogger } from './logger'
import { normalizeSource } from './source'
import { checkSuppression } from './suppression'

import 'server-only'

const SUPPRESSION_WINDOW_MS = 60_000

/**
 * The bounded field set for a *known* primary-content availability failure
 * - logged by `shared/api/server/require-primary.ts` at the exact moment it
 * throws, server-side, before any RSC/error-boundary processing. This is
 * the reliable "loud to the team" guarantee for primary content: it does
 * not depend on `PrimaryUnavailableError`'s fields surviving to a client
 * fallback or to `instrumentation.ts`'s `onRequestError` (neither is
 * guaranteed to see the original error unchanged).
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
