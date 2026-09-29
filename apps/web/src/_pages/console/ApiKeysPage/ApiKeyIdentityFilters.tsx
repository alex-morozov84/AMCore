'use client'

import { useTranslations } from 'next-intl'
import type { AdminApiKeyQuery } from '@amcore/shared'

import { Button } from '@/shared/ui/button'
import { ConsoleFilterActions } from '@/shared/ui/console-detail/ConsoleFilterActions'
import { ConsoleFilterDisclosure } from '@/shared/ui/console-detail/ConsoleFilterDisclosure'
import { ConsoleIdentityLookup } from '@/shared/ui/console-detail/ConsoleIdentityLookup'
import { Input } from '@/shared/ui/input'

export function ApiKeyIdentityFilters({
  query,
  baseHref,
  change,
}: {
  query: AdminApiKeyQuery
  baseHref: string
  change: (patch: Partial<AdminApiKeyQuery>) => void
}) {
  const t = useTranslations('console.apiKeys')
  return (
    <ConsoleFilterDisclosure label={t('identityFilters')}>
      <div className="grid gap-4 md:grid-cols-2">
        <ConsoleIdentityLookup
          inputId="keys-user-lookup"
          label={t('owner')}
          kind="user"
          onSelect={(userId) => change({ userId })}
        />
        <ConsoleIdentityLookup
          inputId="keys-org-lookup"
          label={t('organization')}
          kind="organization"
          onSelect={(organizationId) => change({ organizationId })}
        />
      </div>
      <form method="GET" action={baseHref} className="space-y-4 border-t border-border pt-4">
        {Object.entries(query)
          .filter(([key]) => !['id', 'userId', 'organizationId', 'page'].includes(key))
          .map(([key, value]) =>
            value === undefined ? null : (
              <input key={key} type="hidden" name={key} value={String(value)} />
            )
          )}
        <div className="grid gap-4 md:grid-cols-3">
          {(['userId', 'organizationId', 'id'] as const).map((key) => (
            <label key={key} className="grid gap-2 text-sm font-medium">
              {t(key)}
              <Input name={key} defaultValue={query[key] ?? ''} className="bg-background" />
            </label>
          ))}
        </div>
        <ConsoleFilterActions
          submit={
            <Button type="submit" size="lg">
              {t('apply')}
            </Button>
          }
        />
      </form>
    </ConsoleFilterDisclosure>
  )
}
