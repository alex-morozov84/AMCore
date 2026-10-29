import { setRequestLocale } from 'next-intl/server'

import { SignInAgainMount } from '@/_app/account-security'
import { resolveLocaleParam } from '@/i18n/params'

export const dynamic = 'force-dynamic'
export default async function SignInAgain({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ entryId?: string | string[]; returnEntryId?: string | string[] }>
}) {
  setRequestLocale(await resolveLocaleParam(params))
  return (
    <SignInAgainMount
      query={await searchParams}
      placement={{ apiBase: '/auth', mfaHref: '/mfa', destination: '/' }}
    />
  )
}
