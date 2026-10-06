import { setRequestLocale } from 'next-intl/server'

import { RegisterPage } from '@/_pages/auth'
import { resolveLocaleParam } from '@/i18n/params'
import { redirectIfAuthenticated } from '@/shared/api/bff/dal'
import { getOAuthProviders } from '@/shared/api/bff/oauth-providers'
import { getPublicSignupPolicy } from '@/shared/api/bff/signup-policy'

// `redirectIfAuthenticated()` reads `cookies()` — see the identical export
// on `(dashboard)/page.tsx` for why this avoids build-time noise.
export const dynamic = 'force-dynamic'

export default async function Register({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocaleParam(params)
  setRequestLocale(locale)
  await redirectIfAuthenticated(locale)

  const [oauthProviders, publicSignupEnabled] = await Promise.all([getOAuthProviders(), getPublicSignupPolicy()])

  return <RegisterPage oauthProviders={oauthProviders} publicSignupEnabled={publicSignupEnabled} />
}
