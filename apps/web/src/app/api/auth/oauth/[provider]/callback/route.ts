import { proxyOAuthCallback } from '@/shared/api/bff/oauth-provider-proxy'

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params
  return proxyOAuthCallback(request, provider)
}

// Apple's `response_mode=form_post` posts `code`/`state` as a cross-site
// form body — the only provider that uses POST here.
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params
  return proxyOAuthCallback(request, provider)
}
