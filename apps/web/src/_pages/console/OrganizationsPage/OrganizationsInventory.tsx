import { getTranslations } from 'next-intl/server'
import type { AdminOrganizationListResponse } from '@amcore/shared'

import type { DiscoverySortOrder } from '@/features/console-discovery'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/ui/empty'

import { OrganizationsOutOfRange } from './OrganizationsOutOfRange'
import { OrganizationsPagination } from './OrganizationsPagination'
import { OrganizationsTable } from './OrganizationsTable'
import type { OrganizationsSortableField } from './parse-query'

export interface OrganizationsInventoryProps {
  response: AdminOrganizationListResponse
  baseHref: string
  search?: string
  sortBy: OrganizationsSortableField
  sortOrder?: DiscoverySortOrder
}

export async function OrganizationsInventory({
  response,
  baseHref,
  search,
  sortBy,
  sortOrder,
}: OrganizationsInventoryProps) {
  const t = await getTranslations('console')
  const totalPages = Math.max(1, Math.ceil(response.total / response.limit))

  if (response.total === 0) {
    // Distinct from the out-of-range case below: this is a genuine zero
    // result set, either because no organizations exist yet, or because
    // the active search matched nothing — the two need different copy so
    // an operator doesn't read "no organizations yet" as "the platform is
    // empty" when it's really "your search was too narrow."
    const isFilteredEmpty = Boolean(search)
    return (
      <Empty className="rounded-lg border border-border">
        <EmptyHeader>
          <EmptyTitle>
            {t(isFilteredEmpty ? 'organizationsNoSearchResultsTitle' : 'organizationsEmptyTitle')}
          </EmptyTitle>
          <EmptyDescription>
            {t(
              isFilteredEmpty
                ? 'organizationsNoSearchResultsDescription'
                : 'organizationsEmptyDescription'
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  if (response.page > totalPages) {
    return (
      <OrganizationsOutOfRange
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
      <OrganizationsTable
        organizations={response.data}
        baseHref={baseHref}
        search={search}
        sortBy={sortBy}
        sortOrder={sortOrder}
      />
      <OrganizationsPagination
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
