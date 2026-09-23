import { type AdminOrganizationSortField, PAGINATION } from '@amcore/shared'

import type { DiscoverySortOrder } from '@/features/console-discovery'

/**
 * The Organizations UI's own sortable-field allowlist. Unlike Users (which
 * deliberately excludes `email`), every backend-sortable Organizations
 * field (`name`, `slug`, `createdAt`, `updatedAt`) already has its own
 * visible column, so the UI exposes the full backend set — confirmed with
 * the product owner, not inferred merely from the backend allowlist.
 *
 * Domain-owned here (the Organizations panel/query contract), mirroring
 * `apps/web/src/_pages/console/UsersPage/parse-query.ts`'s
 * `USERS_SORTABLE_FIELDS` pattern exactly — not an app-wide `shared`
 * promotion. `OrganizationsTable.tsx` imports it from this sibling file;
 * `OrganizationsTable.test.tsx` asserts the two stay in sync.
 *
 * The route's `searchParams` → validated-props parsing below is kept as a
 * plain, dependency-free module (no `server-only`/`next-intl/server`) for
 * the same reason as its Users counterpart: `parse-query.test.ts` unit
 * tests it directly without pulling in `OrganizationsPage`'s/
 * `ConsolePageFrame`'s heavier transitive graph.
 */
export const ORGANIZATIONS_SORTABLE_FIELDS = [
  'name',
  'slug',
  'createdAt',
  'updatedAt',
] as const satisfies readonly AdminOrganizationSortField[]

export type OrganizationsSortableField = (typeof ORGANIZATIONS_SORTABLE_FIELDS)[number]

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

export function parseSortBy(
  raw: string | string[] | undefined
): AdminOrganizationSortField | undefined {
  if (typeof raw !== 'string') return undefined
  return (ORGANIZATIONS_SORTABLE_FIELDS as readonly string[]).includes(raw)
    ? (raw as AdminOrganizationSortField)
    : undefined
}

export function parseSortOrder(raw: string | string[] | undefined): DiscoverySortOrder | undefined {
  return raw === 'asc' || raw === 'desc' ? raw : undefined
}
