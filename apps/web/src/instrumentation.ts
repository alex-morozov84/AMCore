import type { Instrumentation } from 'next'

import { logServerError } from '@/shared/lib/server-logger'

/**
 * Next's own hook for **uncaught** server errors that reach an error
 * boundary (`error.js`/`catchError`/the root boundary) — the loud-logging
 * counterpart to `shared/api/server/degrade-secondary.ts`'s silent-degrade
 * logging for *known* availability failures (`ai/models-talk.md` §7). Only
 * fires for errors Next itself catches at a boundary; a `DataOutcome`
 * already handled by `degradeSecondary`/`requirePrimary` never reaches here.
 *
 * `error`'s own fields may already be stripped by Next before this runs
 * (production hides the original message/stack, keeping only `digest`) —
 * logged as-is, never assumed complete. See the installed
 * `node_modules/next/dist/docs/01-app/02-guides/instrumentation.md` and
 * `ai/models-talk.md` §6 for the empirical confirmation of that stripping.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
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
