import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import type { AdminApiKeyQuery } from '@amcore/shared'

import { DiscoverySearchBoundary, SearchInput } from '@/features/console-discovery'
import { getConsoleApiKeysHref } from '@/shared/lib/console-public-href'
import { Skeleton } from '@/shared/ui/skeleton'

import { ApiKeyFilters } from './ApiKeyFilters'
import { ApiKeyResults } from './ApiKeyResults'
import { keyDiscoveryState } from './query-state'

export function ApiKeysPageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-56" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  )
}

export async function ApiKeysPage({ query }: { query: AdminApiKeyQuery }) {
  const t = await getTranslations('console.apiKeys')
  const baseHref = getConsoleApiKeysHref()
  const state = keyDiscoveryState(query)
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-muted-foreground">{t('description')}</p>
      <DiscoverySearchBoundary
        baseHref={baseHref}
        {...state}
        effectiveSortOrder={query.sortOrder ?? (query.sortBy === 'name' ? 'asc' : 'desc')}
      >
        <SearchInput
          label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
          clearLabel={t('clearSearch')}
          inputId="api-key-search"
          maxLength={100}
        />
        <ApiKeyFilters query={query} baseHref={baseHref} />
        <Suspense fallback={<ApiKeysPageSkeleton />}>
          <ApiKeyResults query={query} baseHref={baseHref} />
        </Suspense>
      </DiscoverySearchBoundary>
    </section>
  )
}
