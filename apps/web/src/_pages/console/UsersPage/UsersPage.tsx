import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'

import {
  DiscoverySearchBoundary,
  type DiscoverySortOrder,
  SearchInput,
} from '@/features/console-discovery'
import { getConsoleUsersHref } from '@/shared/lib/console-public-href'

import { getUsersEffectiveSortOrder, type UsersSortableField } from './parse-query'
import { UsersResults } from './UsersResults'
import { UsersResultsSkeleton } from './UsersResultsSkeleton'

const DEFAULT_SORT_BY: UsersSortableField = 'createdAt'

export interface UsersPageProps {
  page: number
  limit: number
  search?: string
  sortBy?: UsersSortableField
  sortOrder?: DiscoverySortOrder
}

/**
 * Platform user inventory, searchable/sortable, with system-role actions
 * composed by `UsersTable`. The heading and search box render immediately
 * — only `UsersResults` (the part that actually needs the backend fetch)
 * sits behind its own `<Suspense>`, so neither loses mounted state nor
 * disappears behind a skeleton on a search/sort/page navigation.
 */
export async function UsersPage({
  page,
  limit,
  search,
  sortBy = DEFAULT_SORT_BY,
  sortOrder,
}: UsersPageProps) {
  const t = await getTranslations('console')
  const baseHref = getConsoleUsersHref()
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold tracking-tight">{t('users')}</h1>
      <DiscoverySearchBoundary
        baseHref={baseHref}
        search={search}
        page={page}
        sortBy={sortBy}
        sortOrder={sortOrder}
        effectiveSortOrder={getUsersEffectiveSortOrder(sortBy, sortOrder)}
      >
        <SearchInput
          label={t('usersSearchLabel')}
          placeholder={t('usersSearchPlaceholder')}
          clearLabel={t('usersSearchClear')}
          inputId="users-search"
        />
        <Suspense fallback={<UsersResultsSkeleton />}>
          <UsersResults
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
