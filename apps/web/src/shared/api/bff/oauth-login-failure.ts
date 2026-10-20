import { NextResponse } from 'next/server'
import { AuthErrorCode, coerceSupportedLocale, localizedFrontendUrl } from '@amcore/shared'

import { oauthLoginErrors } from '@/shared/lib/oauth-login-errors'

import type { ProductWebContext } from './product-web-context.server'

import 'server-only'

/** Invalid state cannot supply a trusted locale or return address. Use language only. */
export async function oauthLoginFailure(
  request: Request,
  provider: string,
  context: ProductWebContext,
  upstream?: Response
): Promise<Response> {
  let code: string = AuthErrorCode.OAUTH_PROVIDER_ERROR
  try {
    const body: unknown = await upstream?.json()
    if (
      body &&
      typeof body === 'object' &&
      'errorCode' in body &&
      typeof body.errorCode === 'string' &&
      oauthLoginErrors.has(body.errorCode)
    )
      code = body.errorCode
  } catch {
    /* Never forward provider diagnostics or raw credentials. */
  }
  const query = new URL(request.url).searchParams
  const selectedLocale = query.getAll('locale').length === 1 ? query.get('locale') : null
  const cookieLocale = request.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)NEXT_LOCALE=([a-z-]+)(?:;|$)/i)?.[1]
  const locale = coerceSupportedLocale(
    selectedLocale ??
      cookieLocale ??
      request.headers.get('accept-language')?.split(',')[0]?.split('-')[0]
  )
  const url = new URL(localizedFrontendUrl(context.origin, locale, context.loginPath))
  url.searchParams.set('oauthError', code)
  const response = NextResponse.redirect(url, 303)
  response.headers.set('cache-control', 'private, no-store')
  response.headers.set('referrer-policy', 'no-referrer')
  response.headers.set('x-robots-tag', 'noindex, nofollow')
  response.cookies.set(
    provider === 'apple' ? 'amcore_admin_oauth_state_apple' : 'amcore_admin_oauth_state',
    '',
    {
      httpOnly: true,
      secure: provider === 'apple' || context.audience === 'staff',
      sameSite: provider === 'apple' ? 'none' : 'lax',
      maxAge: 0,
      path: provider === 'apple' ? '/api/product-admin/auth/oauth/apple/callback' : '/',
    }
  )
  response.cookies.set('__Host-amcore_admin_oauth_refresh', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  })
  return response
}
