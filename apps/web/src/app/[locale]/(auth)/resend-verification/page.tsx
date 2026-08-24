import { setRequestLocale } from 'next-intl/server'

import { ResendVerificationPage } from '@/_pages/auth'
import { resolveLocaleParam } from '@/i18n/params'

/**
 * Not gated by `redirectIfAuthenticated()` — an already-signed-in but
 * unverified account has no other path to this action in the current
 * starter (login doesn't block on `emailVerified`, and there is no
 * dashboard-embedded resend affordance), so this page must stay reachable
 * either way.
 */
export default async function ResendVerification({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const locale = await resolveLocaleParam(params)
  setRequestLocale(locale)

  return <ResendVerificationPage />
}
