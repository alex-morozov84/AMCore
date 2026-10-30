import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { ConsolePageFrame } from '@/_pages/console'
import { getConsoleLogoutIntent } from '@/shared/api/console/access-token'
import { hasCanonicalConsoleHost } from '@/shared/lib/console-host-guard'
import { requireSuperAdmin } from '@/shared/lib/require-super-admin'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'

import { ConsoleProfileClient } from './ui/profile-client'

import 'server-only'

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
