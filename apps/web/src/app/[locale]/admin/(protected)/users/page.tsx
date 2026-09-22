import { ADMIN_USER_SORT_FIELDS, type AdminUserSortField, PAGINATION } from '@amcore/shared'

import { ConsolePageFrame, UsersPage, UsersPageSkeleton } from '@/_pages/console'
import type { DiscoverySortOrder } from '@/features/console-discovery'

interface UsersRouteProps {
  searchParams: Promise<{
    page?: string | string[]
    search?: string | string[]
    sortBy?: string | string[]
    sortOrder?: string | string[]
  }>
}

/** Fails closed to the default page on missing/malformed input, never NaN through to the fetch. */
function parsePage(raw: string | string[] | undefined): number {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return PAGINATION.DEFAULT_PAGE
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) ? parsed : PAGINATION.DEFAULT_PAGE
}

/** Empty/whitespace-only/oversized/array input all mean "no filter" — never forwarded. */
function parseSearch(raw: string | string[] | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.length > 255) return undefined
  return trimmed
}

function parseSortBy(raw: string | string[] | undefined): AdminUserSortField | undefined {
  if (typeof raw !== 'string') return undefined
  return (ADMIN_USER_SORT_FIELDS as readonly string[]).includes(raw)
    ? (raw as AdminUserSortField)
    : undefined
}

function parseSortOrder(raw: string | string[] | undefined): DiscoverySortOrder | undefined {
  return raw === 'asc' || raw === 'desc' ? raw : undefined
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
