import { NextResponse } from 'next/server'

import { apiErrorResponse } from '@/shared/api/bff/api-error-response'
import { isProductMutationTrusted } from '@/shared/api/bff/product-web-context.server'
import { productWebRoute } from '@/shared/api/bff/product-web-route'

import 'server-only'

/** This incomplete deployment cannot start a flow, bind a factor or issue credentials. */
export function accountMfaRoute(request: Request, frontend: 'site' | 'admin') {
  return productWebRoute(
    request,
    frontend === 'site' ? 'site-auth' : 'admin-auth',
    async (context) => {
      if (request.method === 'GET') return NextResponse.json({ kind: 'unavailable' })
      if (!isProductMutationTrusted(request, context))
        return apiErrorResponse(request, {
          statusCode: 403,
          message: 'Request origin rejected',
          errorCode: 'AUTH_ORIGIN_REJECTED',
        })
      return apiErrorResponse(request, { statusCode: 503, message: 'MFA deployment is incomplete' })
    }
  )
}
