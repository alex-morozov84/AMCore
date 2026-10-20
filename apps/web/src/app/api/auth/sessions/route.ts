import { productWebRoute } from '@/shared/api/bff/product-web-route'
import { handleDeleteOtherSessions, handleGetSessions } from '@/shared/api/bff/sessions-handler'

export async function GET(request: Request) {
  return productWebRoute(request, 'product-data', (context) => handleGetSessions(request, context))
}

export async function DELETE(request: Request) {
  return productWebRoute(request, 'product-data', (context) =>
    handleDeleteOtherSessions(request, context)
  )
}
