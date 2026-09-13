import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'

import { ConsoleLoginPage } from '@/_pages/console'
import { resolveLocaleParam } from '@/i18n/params'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

export const dynamic = 'force-dynamic'

export default async function ConsoleLogin({ params }: { params: Promise<{ locale: string }> }) {
  if (ADMIN_CONSOLE_CONFIG.mode !== 'host') notFound()
  setRequestLocale(await resolveLocaleParam(params))
  return <ConsoleLoginPage />
}
