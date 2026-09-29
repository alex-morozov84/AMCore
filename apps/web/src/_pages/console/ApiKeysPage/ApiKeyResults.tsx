import { getTranslations } from 'next-intl/server'
import type { AdminApiKeyQuery } from '@amcore/shared'

import { ApiKeysInventory } from '@/features/console-api-keys'
import {
  buildDiscoveryHref,
  DiscoveryNavigationLink,
  SortableColumnHead,
} from '@/features/console-discovery'
import { fetchConsoleApiKeys } from '@/shared/api/console/api-keys'
import { resolvePrimary } from '@/shared/api/server'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'
import { TableHead } from '@/shared/ui/table'

import { keyDiscoveryState } from './query-state'

export async function ApiKeyResults({
  query,
  baseHref,
}: {
  query: AdminApiKeyQuery
  baseHref: string
}) {
  const t = await getTranslations('console.apiKeys')
  const outcome = resolvePrimary(await fetchConsoleApiKeys(query), { source: 'console-api-keys' })
  if (outcome.status === 'unavailable')
    return <PrimaryUnavailableFallback reason={outcome.reason} />
  const state = keyDiscoveryState(query)
  const href = buildDiscoveryHref(baseHref, state)
  const pages = Math.max(1, Math.ceil(outcome.data.total / query.limit))
  const sortable = (column: AdminApiKeyQuery['sortBy'], label: string) => (
    <SortableColumnHead
      baseHref={baseHref}
      column={column}
      defaultOrder={column === 'name' ? 'asc' : 'desc'}
      current={state}
      visibleLabel={label}
      accessibleLabel={t('sort', { column: label })}
    />
  )
  if (query.page > pages)
    return (
      <DiscoveryNavigationLink href={buildDiscoveryHref(baseHref, { ...state, page: pages })}>
        {t('lastPage')}
      </DiscoveryNavigationLink>
    )
  return (
    <>
      <ApiKeysInventory
        response={outcome.data}
        filtered={
          !!(
            query.search ||
            query.id ||
            query.userId ||
            query.organizationId ||
            query.status !== 'all'
          )
        }
        identity={buildDiscoveryHref(baseHref, {
          ...state,
          sortOrder: query.sortOrder ?? (query.sortBy === 'name' ? 'asc' : 'desc'),
        })}
        returnTo={href}
        headings={
          <>
            <TableHead>
              <span className="sr-only">{t('selection')}</span>
            </TableHead>
            {sortable('name', t('key'))}
            <TableHead>{t('owner')}</TableHead>
            <TableHead>{t('organization')}</TableHead>
            <TableHead>{t('status')}</TableHead>
            {sortable('expiresAt', t('expiry'))}
            {sortable('lastUsedAt', t('usage'))}
            {sortable('revokedAt', t('revokedTime'))}
            {sortable('createdAt', t('created'))}
            <TableHead>{t('actions')}</TableHead>
          </>
        }
      />
      <nav className="flex items-center justify-between text-sm" aria-label={t('pagination')}>
        {query.page > 1 ? (
          <DiscoveryNavigationLink
            href={buildDiscoveryHref(baseHref, { ...state, page: query.page - 1 })}
          >
            {t('previous')}
          </DiscoveryNavigationLink>
        ) : (
          <span />
        )}
        <span>{t('page', { page: query.page, pages })}</span>
        {query.page < pages ? (
          <DiscoveryNavigationLink
            href={buildDiscoveryHref(baseHref, { ...state, page: query.page + 1 })}
          >
            {t('next')}
          </DiscoveryNavigationLink>
        ) : (
          <span />
        )}
      </nav>
    </>
  )
}
