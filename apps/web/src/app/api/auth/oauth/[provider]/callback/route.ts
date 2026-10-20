import { proxyOAuthCallback } from '@/shared/api/bff/oauth-provider-proxy'
import { productWebRoute } from '@/shared/api/bff/product-web-route'

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params
  return productWebRoute(
    request,
    'site-auth',
    (selected) => proxyOAuthCallback(request, provider, selected),
    true
  )
}

// Apple's `response_mode=form_post` posts `code`/`state` as a cross-site
// form body — the only provider that uses POST here.
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params
  return productWebRoute(
    request,
    'site-auth',
    (selected) => proxyOAuthCallback(request, provider, selected),
    true
  )
}
