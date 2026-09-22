import { getTranslations } from 'next-intl/server'
import type { AdminUserSortField } from '@amcore/shared'

import { buildDiscoveryHref, type DiscoverySortOrder } from '@/features/console-discovery'
import { buttonVariants } from '@/shared/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/ui/empty'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

export interface UsersOutOfRangeProps {
  totalPages: number
  baseHref: string
  search?: string
  sortBy: AdminUserSortField
  sortOrder?: DiscoverySortOrder
}

export async function UsersOutOfRange({
  totalPages,
  baseHref,
  search,
  sortBy,
  sortOrder,
}: UsersOutOfRangeProps) {
  const t = await getTranslations('console')
  // Resets only `page` — an operator who narrowed a search and then landed
  // past the last page (e.g. via a stale bookmark) should not also lose
  // that search on recovery.
  const href = buildDiscoveryHref(baseHref, { search, sortBy, sortOrder, page: 1 })
  return (
    <Empty className="rounded-lg border border-border">
      <EmptyHeader>
        <EmptyTitle>{t('usersPageOutOfRangeTitle')}</EmptyTitle>
        <EmptyDescription>{t('usersPageOutOfRangeDescription', { totalPages })}</EmptyDescription>
      </EmptyHeader>
      <RouteProgressLink href={href} className={buttonVariants({ variant: 'outline' })}>
        {t('usersPageOutOfRangeAction')}
      </RouteProgressLink>
    </Empty>
  )
}
