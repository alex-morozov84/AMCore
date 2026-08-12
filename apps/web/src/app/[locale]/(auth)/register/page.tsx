import { setRequestLocale } from 'next-intl/server'

import { resolveLocaleParam } from '@/i18n/params'
import { redirectIfAuthenticated } from '@/shared/api/bff/dal'
import { RegisterPage } from '@/views/auth'

// `redirectIfAuthenticated()` reads `cookies()` — see the identical export
// on `(dashboard)/page.tsx` for why this avoids build-time noise.
export const dynamic = 'force-dynamic'

export default async function Register({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocaleParam(params)
  setRequestLocale(locale)
  await redirectIfAuthenticated(locale)

  return <RegisterPage />
}
