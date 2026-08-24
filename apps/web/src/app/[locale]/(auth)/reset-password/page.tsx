import { setRequestLocale } from 'next-intl/server'

import { ResetPasswordPage } from '@/_pages/auth'
import { resolveLocaleParam } from '@/i18n/params'

/**
 * Not gated by `redirectIfAuthenticated()`: this route is `AuthType.None`
 * on the backend by design — a signed-in user can legitimately follow this
 * link (e.g. from a second tab), and the reset itself deletes every
 * session server-side regardless of who's currently logged in here.
 *
 * `searchParams` (not `cookies()`) is what makes this route dynamic —
 * confirmed against the installed Next docs
 * (`node_modules/next/dist/docs/01-app/02-guides/production-checklist.md`:
 * "Request-time APIs like `cookies` and the `searchParams` prop will opt
 * the entire route into Dynamic Rendering"). No explicit `dynamic` export
 * needed for that reason alone; Next types every search param as possibly
 * repeated, so a real duplicate `?token=` collapses to "no valid token"
 * below, the same state as a missing one.
 */
export default async function ResetPassword({
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

  return <ResetPasswordPage token={token} />
}
