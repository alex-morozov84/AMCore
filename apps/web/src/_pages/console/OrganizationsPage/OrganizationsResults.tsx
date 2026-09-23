import { getTranslations } from 'next-intl/server'

import type { DiscoverySortOrder } from '@/features/console-discovery'
import { fetchConsoleOrganizations } from '@/shared/api/console/organizations'
import { resolvePrimary } from '@/shared/api/server'
import { cn } from '@/shared/lib/utils'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'

import { OrganizationsInventory } from './OrganizationsInventory'
import type { OrganizationsSortableField } from './parse-query'

const MONO = 'font-console-mono'

export interface OrganizationsResultsProps {
  page: number
  limit: number
  search?: string
  sortBy: OrganizationsSortableField
  sortOrder?: DiscoverySortOrder
  baseHref: string
}

/**
 * The one part of the Organizations panel that actually depends on the
 * backend fetch — split out of `OrganizationsPage` (and given its own
 * `<Suspense>` there) so the heading and search box render immediately and
 * stay mounted across a search/sort/page navigation. Mirrors
 * `UsersPage`/`UsersResults` exactly — see that pair's own doc comments for
 * the full rationale.
 */
export async function OrganizationsResults({
  page,
  limit,
  search,
  sortBy,
  sortOrder,
  baseHref,
}: OrganizationsResultsProps) {
  const t = await getTranslations('console')
  const outcome = resolvePrimary(
    await fetchConsoleOrganizations({ page, limit, search, sortBy, sortOrder }),
    { source: 'console-organizations' }
  )
  if (outcome.status === 'unavailable')
    return <PrimaryUnavailableFallback reason={outcome.reason} />
  return (
    <>
      {/* `aria-live`: the count is the one piece of this page a screen-reader
          user needs re-announced after a debounced search navigation — the
          rest of the table is covered by normal page-content semantics. */}
      <p aria-live="polite" className={cn(MONO, 'text-sm text-foreground-muted')}>
        {t('organizationsTotal', { total: outcome.data.total })}
      </p>
      <OrganizationsInventory
        response={outcome.data}
        baseHref={baseHref}
        search={search}
        sortBy={sortBy}
        sortOrder={sortOrder}
      />
    </>
  )
}
