import { productAdminAuthHandlers } from '@/_app/product-admin'

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  return productAdminAuthHandlers.link(request, (await context.params).provider)
}
