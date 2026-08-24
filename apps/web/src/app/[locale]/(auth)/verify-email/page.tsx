import { setRequestLocale } from 'next-intl/server'

import { VerifyEmailPage } from '@/_pages/auth'
import { resolveLocaleParam } from '@/i18n/params'

/**
 * Not gated by `redirectIfAuthenticated()` — see `reset-password/page.tsx`'s
 * identical reasoning: `AuthType.None` on the backend by design, and a
 * signed-in user can legitimately follow this link too.
 *
 * `searchParams` makes this route dynamic on its own — see
 * `reset-password/page.tsx`'s comment for the exact doc citation.
 */
export default async function VerifyEmail({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const locale = await resolveLocaleParam(params)
  setRequestLocale(locale)

  const { token: rawToken } = await searchParams
  const token = typeof rawToken === 'string' ? rawToken : undefined

  return <VerifyEmailPage token={token} />
}
