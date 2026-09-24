import { type AdminUserSortField, PAGINATION } from '@amcore/shared'

import type { DiscoverySortOrder } from '@/features/console-discovery'

/**
 * The Users UI's own sortable-field allowlist — a **subset** of the
 * backend's wider `ADMIN_USER_SORT_FIELDS` (which also allows `email`).
 * `email` deliberately has no sort header (owner decision: sort the "User"
 * column by `name` only). `parseSortBy` below validates against this
 * narrower list, not the backend's — otherwise a bookmarked/shared
 * `?sortBy=email` would silently sort the data with no column header ever
 * showing as active, contradicting the guarantee that the active sort
 * column is always marked.
 *
 * Domain-owned here (the Users panel/query contract), not in an app-wide
 * `shared/lib` module — `UsersTable.tsx` imports it from this sibling file
 * too, and `UsersTable.test.tsx` asserts the two stay in sync, so this is
 * the single source of truth for both sides without promoting a
 * Users-specific policy to universal scope.
 */
export const USERS_SORTABLE_FIELDS = [
  'name',
  'lastLoginAt',
  'createdAt',
  'updatedAt',
] as const satisfies readonly AdminUserSortField[]

export type UsersSortableField = (typeof USERS_SORTABLE_FIELDS)[number]

export const USERS_DEFAULT_SORT_ORDER: Record<UsersSortableField, DiscoverySortOrder> = {
  name: 'asc',
  lastLoginAt: 'desc',
  createdAt: 'desc',
  updatedAt: 'desc',
}

export function getUsersEffectiveSortOrder(
  sortBy: UsersSortableField,
  sortOrder?: DiscoverySortOrder
) {
  return sortOrder ?? USERS_DEFAULT_SORT_ORDER[sortBy]
}

/**
 * The Users route's `searchParams` → validated-props parsing. Kept as a
 * plain, dependency-free module (not inline in `page.tsx`, and not
 * importing anything from `UsersTable.tsx`/`server-only`/`next-intl/
 * server`) so `parse-query.test.ts` can unit test it directly, without
 * pulling in `UsersPage`'s/`ConsolePageFrame`'s own heavy transitive graph
 * just to test a handful of pure string-parsing functions. `page.tsx`
 * consumes these through this slice's public API (`index.ts`), same as it
 * already does for `UsersPage`/`UsersPageSkeleton`.
 */

/** Fails closed to the default page on missing/malformed input, never NaN through to the fetch. */
export function parsePage(raw: string | string[] | undefined): number {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return PAGINATION.DEFAULT_PAGE
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) ? parsed : PAGINATION.DEFAULT_PAGE
}

/** Empty/whitespace-only/oversized/array input all mean "no filter" — never forwarded. */
export function parseSearch(raw: string | string[] | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.length > 255) return undefined
  return trimmed
}

export function parseSortBy(raw: string | string[] | undefined): UsersSortableField | undefined {
  if (typeof raw !== 'string') return undefined
  return (USERS_SORTABLE_FIELDS as readonly string[]).includes(raw)
    ? (raw as UsersSortableField)
    : undefined
}

export function parseSortOrder(raw: string | string[] | undefined): DiscoverySortOrder | undefined {
  return raw === 'asc' || raw === 'desc' ? raw : undefined
}
