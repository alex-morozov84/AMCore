import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'

import {
  DiscoverySearchBoundary,
  type DiscoverySortOrder,
  SearchInput,
} from '@/features/console-discovery'
import { getConsoleOrganizationsHref } from '@/shared/lib/console-public-href'

import { OrganizationsResults } from './OrganizationsResults'
import { OrganizationsResultsSkeleton } from './OrganizationsResultsSkeleton'
import { getOrganizationsEffectiveSortOrder, type OrganizationsSortableField } from './parse-query'

const DEFAULT_SORT_BY: OrganizationsSortableField = 'createdAt'

export interface OrganizationsPageProps {
  page: number
  limit: number
  search?: string
  sortBy?: OrganizationsSortableField
  sortOrder?: DiscoverySortOrder
}

/**
 * Searchable/sortable Organizations panel. Read-only — no detail view: the
 * backend has no per-organization endpoint, so the paginated list is the
 * whole contract. The heading and search box render immediately — only
 * `OrganizationsResults` (the part that actually needs the backend fetch)
 * sits behind its own `<Suspense>`. Mirrors `UsersPage`/`UsersResults`
 * exactly; see that pair's own doc comments for the full rationale.
 */
export async function OrganizationsPage({
  page,
  limit,
  search,
  sortBy = DEFAULT_SORT_BY,
  sortOrder,
}: OrganizationsPageProps) {
  const t = await getTranslations('console')
  const baseHref = getConsoleOrganizationsHref()
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold tracking-tight">{t('organizations')}</h1>
      <DiscoverySearchBoundary
        baseHref={baseHref}
        search={search}
        page={page}
        sortBy={sortBy}
        sortOrder={sortOrder}
        effectiveSortOrder={getOrganizationsEffectiveSortOrder(sortBy, sortOrder)}
      >
        <SearchInput
          label={t('organizationsSearchLabel')}
          placeholder={t('organizationsSearchPlaceholder')}
          clearLabel={t('organizationsSearchClear')}
          inputId="organizations-search"
        />
        <Suspense fallback={<OrganizationsResultsSkeleton />}>
          <OrganizationsResults
            page={page}
            limit={limit}
            search={search}
            sortBy={sortBy}
            sortOrder={sortOrder}
            baseHref={baseHref}
          />
        </Suspense>
      </DiscoverySearchBoundary>
    </section>
  )
}
