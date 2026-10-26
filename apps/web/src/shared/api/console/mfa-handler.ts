import { NextResponse } from 'next/server'

import { apiErrorResponse } from '@/shared/api/bff/api-error-response'
import { isProductMutationTrusted } from '@/shared/api/bff/product-web-context.server'
import { productWebRoute } from '@/shared/api/bff/product-web-route'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { isTrustedConsoleOrigin } from './origin-guard'

import 'server-only'

/** Dormant adapter: never reads a credential, writes a vault or starts MFA. */
export async function handleConsoleMfa(request: Request): Promise<Response> {
  if (ADMIN_CONSOLE_CONFIG.mode === 'path')
    return productWebRoute(request, 'site-auth', async (context) =>
      dormantResponse(request, isProductMutationTrusted(request, context))
    )
  const response = dormantResponse(request, isTrustedConsoleOrigin(request))
  response.headers.set('cache-control', 'private, no-store')
  response.headers.set('x-robots-tag', 'noindex, nofollow')
  return response
}

function dormantResponse(request: Request, trusted: boolean): Response {
  if (request.method === 'GET') return NextResponse.json({ kind: 'unavailable' })
  if (!trusted)
    return apiErrorResponse(request, {
      statusCode: 403,
      message: 'Request origin rejected',
      errorCode: 'AUTH_ORIGIN_REJECTED',
    })
  return apiErrorResponse(request, { statusCode: 503, message: 'MFA deployment is incomplete' })
}
