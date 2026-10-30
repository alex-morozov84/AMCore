import { loginSchema } from '@amcore/shared'

import { apiErrorResponse, zodValidationErrors } from '@/shared/api/bff/api-error-response'
import { authFailureResponse } from '@/shared/api/bff/auth-failure-response'
import { handleBrowserPassword } from '@/shared/api/bff/browser-login-handler'
import { readContextJson } from '@/shared/api/bff/context-body-budget'

import { consoleBrowserContext } from './browser-context'
import { isTrustedConsoleOrigin } from './origin-guard'

import 'server-only'

/** Host Console uses the same exact-attempt publication protocol; no parallel session issuer. */
export async function handleConsoleLogin(request: Request): Promise<Response> {
  try {
    const context = consoleBrowserContext(request)
    if (!isTrustedConsoleOrigin(request))
      return apiErrorResponse(request, {
        statusCode: 403,
        message: 'Request origin rejected',
        errorCode: 'AUTH_ORIGIN_REJECTED',
      })
    if (
      new URL(request.url).search ||
      !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')
    )
      return apiErrorResponse(request, { statusCode: 400, message: 'Invalid login command' })
    const parsed = loginSchema.safeParse(await readContextJson(request.body, 2048))
    if (!parsed.success)
      return apiErrorResponse(request, {
        statusCode: 400,
        message: 'Validation failed',
        errors: zodValidationErrors(parsed.error),
      })
    return await handleBrowserPassword(request, context, parsed.data)
  } catch (error) {
    return authFailureResponse(request, error)
  }
}
