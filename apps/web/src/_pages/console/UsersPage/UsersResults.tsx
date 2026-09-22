import { getTranslations } from 'next-intl/server'
import type { AdminUserSortField } from '@amcore/shared'

import type { DiscoverySortOrder } from '@/features/console-discovery'
import { fetchConsoleUsers } from '@/shared/api/console/users'
import { resolvePrimary } from '@/shared/api/server'
import { cn } from '@/shared/lib/utils'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'

import { UsersInventory } from './UsersInventory'

const MONO = 'font-console-mono'

export interface UsersResultsProps {
  page: number
  limit: number
  search?: string
  sortBy: AdminUserSortField
  sortOrder?: DiscoverySortOrder
  baseHref: string
}

/**
 * The one part of the Users panel that actually depends on the backend
 * fetch. Split out of `UsersPage` (and given its own `<Suspense>` there)
 * so the heading and search box render immediately and stay mounted across
 * a search/sort/page navigation — only this fetch re-suspends, instead of
 * the whole page (including the search box's own client-side debounce
 * state) unmounting and remounting behind `UsersPageSkeleton` on every
 * keystroke commit.
 */
export async function UsersResults({
  page,
  limit,
  search,
  sortBy,
  sortOrder,
  baseHref,
}: UsersResultsProps) {
  const t = await getTranslations('console')
  const outcome = resolvePrimary(
    await fetchConsoleUsers({ page, limit, search, sortBy, sortOrder }),
    { source: 'console-users' }
  )
  if (outcome.status === 'unavailable')
    return <PrimaryUnavailableFallback reason={outcome.reason} />
  return (
    <>
      {/* `aria-live`: the count is the one piece of this page a screen-reader
          user needs re-announced after a debounced search navigation — the
          rest of the table is covered by normal page-content semantics. */}
      <p aria-live="polite" className={cn(MONO, 'text-sm text-foreground-muted')}>
        {t('usersTotal', { total: outcome.data.total })}
      </p>
      <UsersInventory
        response={outcome.data}
        baseHref={baseHref}
        search={search}
        sortBy={sortBy}
        sortOrder={sortOrder}
      />
    </>
  )
}
