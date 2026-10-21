import { legacyAdminRedirect } from '@/_app/product-admin'

export async function GET(
  request: Request,
  context: { params: Promise<{ locale: string; id: string }> }
) {
  return legacyAdminRedirect(request, 'members', await context.params)
}

export const HEAD = GET
