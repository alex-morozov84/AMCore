import { handleBrowserBootstrap } from '@/shared/api/bff/browser-bootstrap-handler'
import { productWebRoute } from '@/shared/api/bff/product-web-route'

export async function POST(request: Request) {
  return productWebRoute(request, 'site-auth', (context) =>
    handleBrowserBootstrap(request, context)
  )
}
