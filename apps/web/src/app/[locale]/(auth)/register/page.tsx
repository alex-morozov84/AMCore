import { setRequestLocale } from 'next-intl/server'

import { resolveLocaleParam } from '@/i18n/params'
import { RegisterPage } from '@/views/auth'

export default async function Register({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(await resolveLocaleParam(params))

  return <RegisterPage />
}
