import { setRequestLocale } from 'next-intl/server'

import { ForgotPasswordPage } from '@/_pages/auth'
import { resolveLocaleParam } from '@/i18n/params'

/**
 * Deliberately not gated by `redirectIfAuthenticated()` — a signed-in user
 * can still legitimately want to reset a password, and gating this page
 * alone while `/reset-password`/`/verify-email` stay open to authenticated
 * users (see those routes) would be an arbitrary asymmetry.
 */
export default async function ForgotPassword({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocaleParam(params)
  setRequestLocale(locale)

  return <ForgotPasswordPage />
}
