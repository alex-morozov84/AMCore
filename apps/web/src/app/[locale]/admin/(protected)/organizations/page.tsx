import { PAGINATION } from '@amcore/shared'

import { ConsolePageFrame } from '@/_pages/console'
import {
  OrganizationsPage,
  OrganizationsPageSkeleton,
  parsePage,
  parseSearch,
  parseSortBy,
  parseSortOrder,
} from '@/_pages/console/OrganizationsPage'

interface OrganizationsRouteProps {
  searchParams: Promise<{
    page?: string | string[]
    search?: string | string[]
    sortBy?: string | string[]
    sortOrder?: string | string[]
  }>
}

export default async function OrganizationsRoute({ searchParams }: OrganizationsRouteProps) {
  const {
    page: rawPage,
    search: rawSearch,
    sortBy: rawSortBy,
    sortOrder: rawSortOrder,
  } = await searchParams
  return (
    <ConsolePageFrame fallback={<OrganizationsPageSkeleton />}>
      <OrganizationsPage
        page={parsePage(rawPage)}
        limit={PAGINATION.DEFAULT_LIMIT}
        search={parseSearch(rawSearch)}
        sortBy={parseSortBy(rawSortBy)}
        sortOrder={parseSortOrder(rawSortOrder)}
      />
    </ConsolePageFrame>
  )
}
