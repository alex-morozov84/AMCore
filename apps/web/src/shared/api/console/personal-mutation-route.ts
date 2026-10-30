import { authFailureResponse } from '@/shared/api/bff/auth-failure-response'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import {
  isProductMutationTrusted,
  type ProductWebContext,
} from '@/shared/api/bff/product-web-context.server'
import { productWebRoute } from '@/shared/api/bff/product-web-route'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { consoleBrowserContext } from './browser-context'
import { isTrustedConsoleOrigin } from './origin-guard'

import 'server-only'

export async function consolePersonalMutation(
  request: Request,
  operation: (context: ProductWebContext) => Promise<Response>
): Promise<Response> {
  if (ADMIN_CONSOLE_CONFIG.mode === 'path')
    return productWebRoute(request, 'site-auth', (context) => {
      if (!isProductMutationTrusted(request, context))
        throw new ContextRequestError(403, 'AUTH_ORIGIN_REJECTED')
      return operation(context)
    })
  let response: Response
  try {
    if (!isTrustedConsoleOrigin(request)) throw new ContextRequestError(403, 'AUTH_ORIGIN_REJECTED')
    response = await operation(consoleBrowserContext(request))
  } catch (error) {
    response = authFailureResponse(request, error)
  }
  response.headers.set('cache-control', 'private, no-store')
  response.headers.set('referrer-policy', 'no-referrer')
  return response
}
