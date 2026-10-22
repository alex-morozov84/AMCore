import { legacyAdminRedirect } from '@/_app/product-admin'

export async function GET(request: Request, context: { params: Promise<{ locale: string }> }) {
  return legacyAdminRedirect(request, 'organizations', await context.params)
}

export const HEAD = GET
