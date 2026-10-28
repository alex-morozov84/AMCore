import type { NextResponse } from 'next/server'

import { apiErrorResponse } from './api-error-response'
import { ContextRequestError } from './context-errors'
import { isInvalidRefreshError, SessionNotFoundError, SessionRefreshUnsafeError } from './errors'

import 'server-only'

/**
 * Classifies whatever `ensureFreshSession` threw into the response a Route
 * Handler should send. Shared by every dedicated/generic proxy handler that
 * calls `ensureFreshSession` directly (`authenticated-proxy.ts`,
 * `sessions-handler.ts`) — extracted once it had a third caller.
 *
 * Only an explicit "this credential is dead" signal (`SessionNotFoundError`,
 * `SessionRefreshUnsafeError`, or `isInvalidRefreshError` — backend
 * `401 TOKEN_INVALID`) maps to 401. Everything else — Redis/lock trouble,
 * or a transient `upstreamRefresh` failure (`code: 'network'`, a backend
 * 5xx) — fails closed as 503 rather than either
 * logging the user out or crashing into an unhandled 500.
 */
export function authFailureResponse(request: Request, error: unknown): NextResponse {
  if (error instanceof ContextRequestError)
    return apiErrorResponse(request, {
      statusCode: error.status,
      message: 'Session verification failed',
      errorCode: error.errorCode,
    })
  if (error instanceof SessionNotFoundError || error instanceof SessionRefreshUnsafeError) {
    return apiErrorResponse(request, { statusCode: 401, message: 'Not authenticated' })
  }
  if (isInvalidRefreshError(error)) {
    return apiErrorResponse(request, { statusCode: 401, message: 'Not authenticated' })
  }
  // SessionVaultUnavailableError, SessionLockTimeoutError, or a transient
  // upstreamRefresh failure — cannot prove auth right now, not "logged out."
  return apiErrorResponse(request, {
    statusCode: 503,
    message: 'Authentication temporarily unavailable',
  })
}
