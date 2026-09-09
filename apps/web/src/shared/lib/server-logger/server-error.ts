import { getServerLogger } from './logger'
import { checkSuppression } from './suppression'

import 'server-only'

const SUPPRESSION_WINDOW_MS = 60_000
const MAX_MESSAGE_LENGTH = 500
const MAX_FIELD_LENGTH = 200

function cap(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) return undefined
  return value.length > maxLength ? `${value.slice(0, maxLength)}...(truncated)` : value
}

/**
 * The bounded field set for an *uncaught* server error
 * (`apps/web/src/instrumentation.ts`'s `onRequestError`) - the loud-logging
 * half for failures a user does see (a real error boundary rendered),
 * complementing `degradation-event.ts`'s silent-degrade half for secondary
 * data. `message`/`digest` may already be reduced by Next before this runs
 * (production replaces the original message with a generic one) - logged
 * as whatever arrives, capped, never assumed complete or original.
 */
export interface LogServerErrorInput {
  routePath: string
  routeType: string
  digest?: string
  message?: string
}

export function logServerError(input: LogServerErrorInput): void {
  const routePath = cap(input.routePath, MAX_FIELD_LENGTH) ?? 'unknown'
  const digest = cap(input.digest, 128)
  const key = `uncaught_server_error:${routePath}:${digest ?? 'no-digest'}`
  const { shouldLog, suppressedSinceLastLog, globalOverflowSuppressedSinceLastLog } =
    checkSuppression(key, SUPPRESSION_WINDOW_MS)
  if (!shouldLog) return

  getServerLogger().error(
    {
      event: 'uncaught_server_error',
      routePath,
      routeType: cap(input.routeType, 32),
      digest,
      message: cap(input.message, MAX_MESSAGE_LENGTH),
      ...(suppressedSinceLastLog > 0 ? { suppressedSinceLastLog } : {}),
      ...(globalOverflowSuppressedSinceLastLog > 0 ? { globalOverflowSuppressedSinceLastLog } : {}),
    },
    'uncaught_server_error'
  )
}
