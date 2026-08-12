import { proxyOAuthAuthorize } from '@/shared/api/bff/oauth-provider-proxy'

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params
  return proxyOAuthAuthorize(request, provider)
}
