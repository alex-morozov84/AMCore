import { hasLocale } from 'next-intl'

import { routing } from '@/i18n/routing'
import { handleOAuthExchange } from '@/shared/api/bff/oauth-exchange-handler'

/**
 * A Route Handler, not a page: cookies can only be set from a Server Action
 * or a Route Handler, never during a Server Component's render — see
 * `oauth-exchange-handler.ts`. The backend always constructs this URL with
 * the account's own stored locale (`coerceSupportedLocale`), but this
 * endpoint is reachable directly, so it's still validated rather than trusted.
 */
export async function GET(request: Request, context: { params: Promise<{ locale: string }> }) {
  const { locale } = await context.params
  if (!hasLocale(routing.locales, locale)) {
    return new Response('Not Found', { status: 404 })
  }

  return handleOAuthExchange(request, locale)
}
