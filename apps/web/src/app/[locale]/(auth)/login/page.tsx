import { setRequestLocale } from 'next-intl/server'

import { LoginPage } from '@/_pages/auth'
import { resolveLocaleParam } from '@/i18n/params'
import { redirectIfAuthenticated } from '@/shared/api/bff/dal'
import { getOAuthProviders } from '@/shared/api/bff/oauth-providers'

// `redirectIfAuthenticated()` reads `cookies()` — see the identical export
// on `(dashboard)/page.tsx` for why this avoids build-time noise.
export const dynamic = 'force-dynamic'

export default async function Login({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ oauthError?: string | string[] }>
}) {
  const locale = await resolveLocaleParam(params)
  setRequestLocale(locale)
  await redirectIfAuthenticated(locale)

  const [oauthProviders, { oauthError }] = await Promise.all([getOAuthProviders(), searchParams])

  return <LoginPage oauthProviders={oauthProviders} oauthError={oauthError} />
}
