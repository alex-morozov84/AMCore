import { handleLogout } from '@/shared/api/bff/logout-handler'
import { productWebRoute } from '@/shared/api/bff/product-web-route'

export async function POST(request: Request): Promise<Response> {
  return productWebRoute(request, 'site-auth', (context) => handleLogout(request, context))
}
