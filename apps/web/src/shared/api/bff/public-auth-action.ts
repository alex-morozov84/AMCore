import { NextResponse } from 'next/server'
import { AuthErrorCode } from '@amcore/shared'
import type { ZodType } from 'zod'

import { apiErrorResponse, zodValidationErrors } from './api-error-response'
import { isTrustedOrigin } from './origin-guard'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'

export interface PublicAuthActionOptions<TInput> {
  schema: ZodType<TInput>
  backendPath: string
}

/**
 * Shared implementation behind the four email-link auth actions
 * (`forgot-password`, `reset-password`, `verify-email`,
 * `resend-verification`): CSRF-check the request, validate the body, call
 * the backend server-side, forward its response verbatim.
 *
 * Deliberately **not** `handleCredentialAuth` — that helper mints a session
 * from a `refresh_token` the backend sets, which none of these four actions
 * return (they're all `AuthType.None` on the backend and either return a
 * `{ message }` or nothing at all). It is also deliberately **not** routed
 * through the generic authenticated proxy (`authenticated-proxy.ts`) — that
 * proxy requires an existing `amcore_session` cookie and 401s without one,
 * which is exactly the case for all four callers here: a user resetting a
 * forgotten password isn't logged in, and an email-verification link may be
 * opened in a browser holding no cookies at all.
 */
export async function handlePublicAuthAction<TInput>(
  request: Request,
  options: PublicAuthActionOptions<TInput>
): Promise<NextResponse> {
  if (!isTrustedOrigin(request)) {
    return apiErrorResponse(request, {
      statusCode: 403,
      message: 'Request origin rejected',
      errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
    })
  }

  const rawBody = await request.json().catch(() => null)
  const parsed = options.schema.safeParse(rawBody)
  if (!parsed.success) {
    return apiErrorResponse(request, {
      statusCode: 400,
      message: 'Validation failed',
      errors: zodValidationErrors(parsed.error),
    })
  }

  const upstreamResponse = await fetch(`${API_URL}/api/v1${options.backendPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed.data),
  })

  if (upstreamResponse.status === 204) {
    return new NextResponse(null, { status: 204 })
  }

  const body = await upstreamResponse.json().catch(() => null)
  return NextResponse.json(body, { status: upstreamResponse.status })
}
