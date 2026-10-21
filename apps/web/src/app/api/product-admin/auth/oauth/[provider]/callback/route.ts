import { productAdminAuthHandlers } from '@/_app/product-admin'

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params
  return productAdminAuthHandlers.callback(request, provider)
}

export const POST = GET
