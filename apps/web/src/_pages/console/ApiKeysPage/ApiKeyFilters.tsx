'use client'

import { useTranslations } from 'next-intl'
import type { AdminApiKeyQuery } from '@amcore/shared'

import { useDiscoveryDraftDiscard } from '@/features/console-discovery'
import { ConsoleFilterActions } from '@/shared/ui/console-detail/ConsoleFilterActions'
import { ConsoleFilterReset } from '@/shared/ui/console-detail/ConsoleFilterReset'

import { ApiKeyIdentityFilters } from './ApiKeyIdentityFilters'
import { ApiKeyStatusFilter } from './ApiKeyStatusFilter'
import { useApiKeyFilterNavigation } from './use-api-key-filter-navigation'

export function ApiKeyFilters({ query, baseHref }: { query: AdminApiKeyQuery; baseHref: string }) {
  const t = useTranslations('console.apiKeys')
  const change = useApiKeyFilterNavigation(query, baseHref)
  const discardDraft = useDiscoveryDraftDiscard()
  return (
    <div className="space-y-3">
      <ApiKeyStatusFilter status={query.status} onChange={(status) => change({ status })} />
      <ApiKeyIdentityFilters query={query} baseHref={baseHref} change={change} />
      {(query.userId || query.organizationId || query.id) && (
        <p className="break-all text-sm text-muted-foreground">
          {t('applied')} {query.userId} {query.organizationId} {query.id}
        </p>
      )}
      <ConsoleFilterActions
        reset={
          <ConsoleFilterReset href={baseHref} label={t('clear')} onClick={() => discardDraft?.()} />
        }
      />
    </div>
  )
}
