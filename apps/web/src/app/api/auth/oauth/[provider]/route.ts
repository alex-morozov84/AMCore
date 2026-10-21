import { proxyOAuthAuthorize } from '@/shared/api/bff/oauth-provider-proxy'
import { productWebRoute } from '@/shared/api/bff/product-web-route'

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params
  return productWebRoute(request, 'site-auth', (selected) =>
    proxyOAuthAuthorize(request, provider, selected)
  )
}
