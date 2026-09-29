'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import type { AdminApiKeyQuery } from '@amcore/shared'

import { buildDiscoveryHref, useDiscoveryDraftDiscard } from '@/features/console-discovery'
import { lookupConsoleIdentity } from '@/shared/api/console/identity-lookup-client'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { Button } from '@/shared/ui/button'
import { IdentityLookup } from '@/shared/ui/identity-lookup'

import { keyDiscoveryState } from './query-state'

export function ApiKeyFilters({ query, baseHref }: { query: AdminApiKeyQuery; baseHref: string }) {
  const t = useTranslations('console.apiKeys')
  const audit = useTranslations('console.audit')
  const router = useRouteProgressRouter()
  const discardDraft = useDiscoveryDraftDiscard()
  const lookupUser = useCallback((term: string) => lookupConsoleIdentity('user', term), [])
  const lookupOrg = useCallback((term: string) => lookupConsoleIdentity('organization', term), [])
  function change(patch: Partial<AdminApiKeyQuery>) {
    discardDraft?.()
    router.push(buildDiscoveryHref(baseHref, keyDiscoveryState({ ...query, ...patch, page: 1 })))
  }
  const copy = {
    lookupSearch: audit('lookupSearch'),
    lookupSubmit: audit('lookupSubmit'),
    lookupSelect: audit('lookupSelect'),
    lookupError: audit('lookupError'),
    lookupRefine: audit('lookupRefine'),
    loading: audit('loading'),
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          {t('status')}
          <select
            value={query.status}
            onChange={(event) =>
              change({ status: event.target.value as AdminApiKeyQuery['status'] })
            }
            className="block rounded-md border border-input bg-background px-3 py-2"
          >
            {(['all', 'unexpired', 'expired', 'revoked'] as const).map((status) => (
              <option key={status} value={status}>
                {t(status)}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
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
      </div>
      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-sm">{t('identityFilters')}</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <IdentityLookup
            inputId="keys-user-lookup"
            label={t('owner')}
            copy={copy}
            searchItems={lookupUser}
            onSelect={(userId) => change({ userId })}
          />
          <IdentityLookup
            inputId="keys-org-lookup"
            label={t('organization')}
            copy={copy}
            searchItems={lookupOrg}
            onSelect={(organizationId) => change({ organizationId })}
          />
        </div>
        <form method="GET" action={baseHref} className="mt-3 flex flex-wrap gap-3">
          {Object.entries(query)
            .filter(([key]) => !['id', 'userId', 'organizationId', 'page'].includes(key))
            .map(([key, value]) =>
              value === undefined ? null : (
                <input key={key} type="hidden" name={key} value={String(value)} />
              )
            )}
          {(['userId', 'organizationId', 'id'] as const).map((key) => (
            <label key={key} className="text-sm">
              {t(key)}
              <input
                name={key}
                defaultValue={query[key] ?? ''}
                className="mt-1 block rounded-md border border-input bg-background px-3 py-2"
              />
            </label>
          ))}
          <Button type="submit" variant="outline">
            {t('apply')}
          </Button>
        </form>
      </details>
      {(query.userId || query.organizationId || query.id) && (
        <p className="break-all text-sm text-muted-foreground">
          {t('applied')} {query.userId} {query.organizationId} {query.id}
        </p>
      )}
    </div>
  )
}
