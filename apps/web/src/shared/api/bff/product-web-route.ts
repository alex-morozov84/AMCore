import { apiErrorResponse } from './api-error-response'
import { authFailureResponse } from './auth-failure-response'
import { ContextRequestError } from './context-errors'
import {
  isProductMutationTrusted,
  type ProductRouteKind,
  type ProductWebContext,
  resolveProductWebContext,
} from './product-web-context.server'

import 'server-only'

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

function privateResponse(response: Response): Response {
  response.headers.set('cache-control', 'private, no-store')
  response.headers.set('x-robots-tag', 'noindex, nofollow')
  return response
}

/** Every public entry selects context before cookies, vaults, refresh or upstream work. */
export async function productWebRoute(
  request: Request,
  kind: ProductRouteKind,
  work: (context: ProductWebContext) => Promise<Response>,
  providerCallback = false
): Promise<Response> {
  try {
    const context = resolveProductWebContext(request.headers, kind)
    if (
      !providerCallback &&
      !safeMethods.has(request.method) &&
      (context.frontend === 'admin' || context.audience === 'staff') &&
      !isProductMutationTrusted(request, context)
    )
      throw new ContextRequestError(403, 'AUTH_ORIGIN_REJECTED')
    return privateResponse(await work(context))
  } catch (error) {
    if (error instanceof ContextRequestError)
      return privateResponse(
        apiErrorResponse(request, {
          statusCode: error.status,
          message: 'Request rejected',
          errorCode: error.errorCode,
        })
      )
    return privateResponse(authFailureResponse(request, error))
  }
}
