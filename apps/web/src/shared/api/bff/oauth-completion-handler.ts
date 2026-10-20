import { ContextRequestError } from './context-errors'
import { readOAuthCompletion } from './oauth-completion-body'
import { handleOAuthExchange } from './oauth-exchange-handler'
import type { ProductWebContext } from './product-web-context.server'
import { productWebRoute } from './product-web-route'

import 'server-only'

async function complete(request: Request, context: ProductWebContext) {
  if (request.method !== 'POST')
    return new Response(null, { status: 405, headers: { allow: 'POST' } })
  // Both site and admin require Origin; legacy site/Referer permissiveness is inapplicable.
  if (request.headers.get('origin') !== context.origin)
    throw new ContextRequestError(403, 'AUTH_ORIGIN_REJECTED')
  if (new URL(request.url).search) throw new ContextRequestError(400, 'BAD_REQUEST')
  const input = await readOAuthCompletion(request)
  return handleOAuthExchange(request, input, context)
}

export async function handleOAuthCompletion(request: Request, kind: 'site-auth' | 'admin-auth') {
  const response = await productWebRoute(request, kind, (context) => complete(request, context))
  response.headers.set('referrer-policy', 'no-referrer')
  return response
}
