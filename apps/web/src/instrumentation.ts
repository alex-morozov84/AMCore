import type { Instrumentation } from 'next'

import { logServerError } from '@/shared/lib/server-logger'

/**
 * Next's own hook for **uncaught** server errors that reach an error
 * boundary (`error.js`/`catchError`/the root boundary) - genuinely
 * unexpected exceptions, not the known `429`/`5xx`/timeout/network
 * failures `shared/api/server/degrade-secondary.ts`/`resolve-primary.ts`
 * already handle as ordinary `DataOutcome` branches (logged there, never
 * thrown, so they never reach this hook at all).
 *
 * `error`'s own fields may already be reduced by Next before this runs.
 * Only its bounded name/digest are retained; arbitrary thrown values and
 * free-form messages are never stringified into the structured log.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  const errorName = error instanceof Error ? error.name : typeof error
  const digest =
    typeof error === 'object' && error !== null && 'digest' in error
      ? String((error as { digest?: unknown }).digest)
      : undefined

  logServerError({
    routePath: context.routePath,
    routeType: context.routeType,
    digest,
    errorName,
  })
}
