import { setRequestLocale } from 'next-intl/server'

import { AccountSecurityMount } from '@/_app/account-security'
import { resolveLocaleParam } from '@/i18n/params'

export default async function AccountSecurity({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocaleParam(params)
  setRequestLocale(locale)
  return <AccountSecurityMount frontend="site" pending />
}
