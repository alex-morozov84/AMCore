import { handleAccountMfa } from '@/shared/api/bff/account-mfa-handler'
import { apiErrorResponse } from '@/shared/api/bff/api-error-response'
import { isProductMutationTrusted } from '@/shared/api/bff/product-web-context.server'
import { productWebRoute } from '@/shared/api/bff/product-web-route'

import 'server-only'

/** Host-selected pending capabilities never enter the ordinary authenticated proxy. */
export async function accountMfaRoute(
  request: Request,
  frontend: 'site' | 'admin',
  startStatus = false
) {
  const response = await productWebRoute(
    request,
    frontend === 'site' ? 'site-auth' : 'admin-auth',
    async (context) => {
      if (request.method !== 'GET' && !isProductMutationTrusted(request, context))
        return apiErrorResponse(request, {
          statusCode: 403,
          message: 'Request origin rejected',
          errorCode: 'AUTH_ORIGIN_REJECTED',
        })
      return handleAccountMfa(request, context, startStatus)
    }
  )
  response.headers.set('referrer-policy', 'no-referrer')
  return response
}
