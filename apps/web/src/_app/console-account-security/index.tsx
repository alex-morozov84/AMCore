import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'

import { AccountSecurityPage } from '@/_pages/account-security'
import { ConsolePageFrame } from '@/_pages/console'
import { ClientMessages } from '@/i18n/client-message-boundary'
import { redirect } from '@/i18n/navigation'
import { getConsoleLogoutIntent } from '@/shared/api/console/access-token'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'
import { hasCanonicalConsoleHost } from '@/shared/lib/console-host-guard'
import { getConsoleAccountSecurityHref } from '@/shared/lib/console-public-href'
import { requireSuperAdmin } from '@/shared/lib/require-super-admin'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'

import { ConsoleAccountSecurityClient } from './ui/client'
import { ConsoleProfileClient } from './ui/profile-client'

import 'server-only'

/** Pending authentication must not require the admitted Console shell. */
export async function ConsoleAccountSecurityMount({ pending = false }: { pending?: boolean }) {
  if (!(await hasCanonicalConsoleHost())) notFound()
  if (pending && ADMIN_CONSOLE_CONFIG.mode !== 'host') notFound()
  if (!pending && (await requireSuperAdmin()) === 'unavailable')
    return <PrimaryUnavailableFallback reason="upstream" />
  if (!pending)
    return redirect({ href: getConsoleAccountSecurityHref(), locale: await getLocale() })
  return (
    <ClientMessages namespaces={['accountMfa']}>
      <AccountSecurityPage standalone>
        <ConsoleAccountSecurityClient />
      </AccountSecurityPage>
    </ClientMessages>
  )
}

export async function ConsoleProfileMount() {
  if (!(await hasCanonicalConsoleHost())) notFound()
  if ((await requireSuperAdmin()) === 'unavailable')
    return <PrimaryUnavailableFallback reason="upstream" />
  const scope = await getConsoleLogoutIntent()
  if (!scope) return <PrimaryUnavailableFallback reason="upstream" />
  const t = await getTranslations('console')
  return (
    <ConsolePageFrame fallback={null}>
      <div className="space-y-8">
        <h1 className="text-2xl font-semibold">{t('profileSettings')}</h1>
        <ConsoleProfileClient key={scope} scope={scope} />
      </div>
    </ConsolePageFrame>
  )
}
