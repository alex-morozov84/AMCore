import { getTranslations } from 'next-intl/server'

import { fetchConsoleUsers } from '@/shared/api/console/users'
import { resolvePrimary } from '@/shared/api/server'
import { cn } from '@/shared/lib/utils'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'

import { UsersInventory } from './UsersInventory'

const MONO = 'font-console-mono'

export interface UsersPageProps {
  page: number
  limit: number
}

/** Platform user inventory with system-role actions composed by `UsersTable`. */
export async function UsersPage({ page, limit }: UsersPageProps) {
  const t = await getTranslations('console')
  const outcome = resolvePrimary(await fetchConsoleUsers(page, limit), { source: 'console-users' })
  if (outcome.status === 'unavailable')
    return <PrimaryUnavailableFallback reason={outcome.reason} />
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">{t('users')}</h1>
        <p className={cn(MONO, 'text-sm text-foreground-muted')}>
          {t('usersTotal', { total: outcome.data.total })}
        </p>
      </div>
      <UsersInventory response={outcome.data} />
    </section>
  )
}
