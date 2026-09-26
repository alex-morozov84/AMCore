import { getTranslations } from 'next-intl/server'
import type { AdminUserListResponse, AdminUserSortField } from '@amcore/shared'

import type { DiscoverySortOrder } from '@/features/console-discovery'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/ui/empty'

import { UsersOutOfRange } from './UsersOutOfRange'
import { UsersPagination } from './UsersPagination'
import { UsersTable } from './UsersTable'

export interface UsersInventoryProps {
  response: AdminUserListResponse
  baseHref: string
  search?: string
  sortBy: AdminUserSortField
  sortOrder?: DiscoverySortOrder
}

export async function UsersInventory({
  response,
  baseHref,
  search,
  sortBy,
  sortOrder,
}: UsersInventoryProps) {
  const t = await getTranslations('console')
  const totalPages = Math.max(1, Math.ceil(response.total / response.limit))

  if (response.total === 0) {
    // Distinct from the out-of-range case below: this is a genuine zero
    // result set, either because the platform has no users yet, or
    // because the active search matched nothing — the two need different
    // copy so an operator doesn't read "no users yet" as "the platform is
    // empty" when it's really "your search was too narrow."
    const isFilteredEmpty = Boolean(search)
    return (
      <Empty className="rounded-lg border border-border">
        <EmptyHeader>
          <EmptyTitle>
            {t(isFilteredEmpty ? 'usersNoSearchResultsTitle' : 'usersEmptyTitle')}
          </EmptyTitle>
          <EmptyDescription>
            {t(isFilteredEmpty ? 'usersNoSearchResultsDescription' : 'usersEmptyDescription')}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  if (response.page > totalPages) {
    return (
      <UsersOutOfRange
        totalPages={totalPages}
        baseHref={baseHref}
        search={search}
        sortBy={sortBy}
        sortOrder={sortOrder}
      />
    )
  }
  return (
    <>
      <UsersTable
        users={response.data}
        page={response.page}
        baseHref={baseHref}
        search={search}
        sortBy={sortBy}
        sortOrder={sortOrder}
      />
      <UsersPagination
        page={response.page}
        totalPages={totalPages}
        baseHref={baseHref}
        search={search}
        sortBy={sortBy}
        sortOrder={sortOrder}
      />
    </>
  )
}
