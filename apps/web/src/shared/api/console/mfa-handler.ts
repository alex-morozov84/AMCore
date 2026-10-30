import { handleAccountMfa } from '@/shared/api/bff/account-mfa-handler'
import { apiErrorResponse } from '@/shared/api/bff/api-error-response'
import { authFailureResponse } from '@/shared/api/bff/auth-failure-response'
import { productWebRoute } from '@/shared/api/bff/product-web-route'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { consoleBrowserContext } from './browser-context'
import { isTrustedConsoleOrigin } from './origin-guard'

import 'server-only'

export async function handleConsoleMfa(request: Request, startStatus = false): Promise<Response> {
  if (ADMIN_CONSOLE_CONFIG.mode === 'path')
    return productWebRoute(request, 'site-auth', (context) =>
      handleAccountMfa(request, context, startStatus)
    )
  let response: Response
  try {
    const context = consoleBrowserContext(request)
    response =
      request.method !== 'GET' && !isTrustedConsoleOrigin(request)
        ? apiErrorResponse(request, {
            statusCode: 403,
            message: 'Request origin rejected',
            errorCode: 'AUTH_ORIGIN_REJECTED',
          })
        : await handleAccountMfa(request, context, startStatus)
  } catch (error) {
    response = authFailureResponse(request, error)
  }
  response.headers.set('cache-control', 'private, no-store')
  response.headers.set('x-robots-tag', 'noindex, nofollow')
  response.headers.set('referrer-policy', 'no-referrer')
  return response
}
