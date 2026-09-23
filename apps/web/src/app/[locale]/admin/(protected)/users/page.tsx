import { PAGINATION } from '@amcore/shared'

import { ConsolePageFrame } from '@/_pages/console'
import {
  parsePage,
  parseSearch,
  parseSortBy,
  parseSortOrder,
  UsersPage,
  UsersPageSkeleton,
} from '@/_pages/console/UsersPage'

interface UsersRouteProps {
  searchParams: Promise<{
    page?: string | string[]
    search?: string | string[]
    sortBy?: string | string[]
    sortOrder?: string | string[]
  }>
}

export default async function UsersRoute({ searchParams }: UsersRouteProps) {
  const {
    page: rawPage,
    search: rawSearch,
    sortBy: rawSortBy,
    sortOrder: rawSortOrder,
  } = await searchParams
  return (
    <ConsolePageFrame fallback={<UsersPageSkeleton />}>
      <UsersPage
        page={parsePage(rawPage)}
        limit={PAGINATION.DEFAULT_LIMIT}
        search={parseSearch(rawSearch)}
        sortBy={parseSortBy(rawSortBy)}
        sortOrder={parseSortOrder(rawSortOrder)}
      />
    </ConsolePageFrame>
  )
}
