'use client'

import { useTranslations } from 'next-intl'
import type { AdminApiKeyQuery } from '@amcore/shared'

import { Button } from '@/shared/ui/button'
import { ConsoleFilterActions } from '@/shared/ui/console-detail/ConsoleFilterActions'

import { ApiKeyIdentityFilters } from './ApiKeyIdentityFilters'
import { ApiKeyStatusFilter } from './ApiKeyStatusFilter'
import { useApiKeyFilterNavigation } from './use-api-key-filter-navigation'

export function ApiKeyFilters({ query, baseHref }: { query: AdminApiKeyQuery; baseHref: string }) {
  const t = useTranslations('console.apiKeys')
  const change = useApiKeyFilterNavigation(query, baseHref)
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
          <Button
            variant="outline"
            size="lg"
            onClick={() =>
              change({
                search: undefined,
                userId: undefined,
                organizationId: undefined,
                id: undefined,
                status: 'all',
              })
            }
          >
            {t('clear')}
          </Button>
        }
      />
    </div>
  )
}
