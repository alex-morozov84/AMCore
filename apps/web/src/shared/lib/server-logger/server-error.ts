import { getServerLogger } from './logger'
import { checkSuppression } from './suppression'

import 'server-only'

const SUPPRESSION_WINDOW_MS = 60_000

/**
 * The bounded field set for an *uncaught* server error (via
 * `instrumentation.ts`'s `onRequestError`) — the loud-logging half for
 * primary-content failures that a user does see, complementing
 * `degradation-event.ts`'s silent-degrade half for secondary data
 * (`ai/models-talk.md` §7). `message`/`digest` may already be stripped by
 * Next in production before this runs — logged as-is, never assumed
 * complete.
 */
export interface ServerErrorEvent {
  routePath: string
  routeType: string
  digest?: string
  message?: string
}

export function logServerError(fields: ServerErrorEvent): void {
  const key = `uncaught_server_error:${fields.routePath}:${fields.digest ?? 'no-digest'}`
  const { shouldLog, suppressedSinceLastLog } = checkSuppression(key, SUPPRESSION_WINDOW_MS)
  if (!shouldLog) return

  const record = suppressedSinceLastLog > 0 ? { ...fields, suppressedSinceLastLog } : fields
  getServerLogger().error(record, 'uncaught_server_error')
}
