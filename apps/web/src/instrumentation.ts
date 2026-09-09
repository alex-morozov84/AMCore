import type { Instrumentation } from 'next'

import { isPrimaryUnavailableError } from '@/shared/api/server/require-primary'
import { logServerError } from '@/shared/lib/server-logger'

/**
 * Next's own hook for **uncaught** server errors that reach an error
 * boundary (`error.js`/`catchError`/the root boundary) - the loud-logging
 * counterpart to `shared/api/server/degrade-secondary.ts`'s silent-degrade
 * logging for *known* availability failures. Only fires for errors Next
 * itself observes reaching a boundary; a `DataOutcome` already handled by
 * `degradeSecondary()` never reaches here.
 *
 * A `PrimaryUnavailableError` (thrown by `requirePrimary()`) is skipped
 * here: it already logged itself, server-side, exactly once, at the moment
 * it was thrown - before any error-boundary/RSC processing that might
 * otherwise reduce its fields. This check is best-effort (the installed
 * Next docs warn this hook may not receive the original error instance
 * unchanged) - not yet verified against a real running boundary, since none
 * exists until PR2 ships `shared/ui/section-error-boundary.tsx`.
 *
 * `error`'s own fields may already be reduced by Next before this runs
 * (production replaces the original message with a generic one, keeping
 * only `digest`) - logged as whatever arrives, capped, never assumed
 * complete or original.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  if (isPrimaryUnavailableError(error)) return

  const message = error instanceof Error ? error.message : String(error)
  const digest =
    typeof error === 'object' && error !== null && 'digest' in error
      ? String((error as { digest?: unknown }).digest)
      : undefined

  logServerError({
    routePath: context.routePath,
    routeType: context.routeType,
    digest,
    message,
  })
}
