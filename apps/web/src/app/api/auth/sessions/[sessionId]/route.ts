import { productWebRoute } from '@/shared/api/bff/product-web-route'
import { handleDeleteSession } from '@/shared/api/bff/sessions-handler'

export async function DELETE(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await context.params
  return productWebRoute(request, 'product-data', (selected) =>
    handleDeleteSession(request, sessionId, selected)
  )
}
