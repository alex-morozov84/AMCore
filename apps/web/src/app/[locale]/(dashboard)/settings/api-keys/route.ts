import { legacyAdminRedirect } from '@/_app/product-admin'

export async function GET(request: Request, context: { params: Promise<{ locale: string }> }) {
  return legacyAdminRedirect(request, 'own-keys', await context.params)
}

export const HEAD = GET
