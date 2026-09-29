'use client'

import { useTranslations } from 'next-intl'
import type { AdminApiKey } from '@amcore/shared'

import {
  getConsoleOrganizationDetailHref,
  getConsoleUserDetailHref,
} from '@/shared/lib/console-public-href'
import { ConsoleContextLink } from '@/shared/ui/console-detail/ConsoleContextLink'
import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'
import { CopyConsoleId } from '@/shared/ui/console-detail/CopyConsoleId'

export function ApiKeyName({ row }: { row: AdminApiKey }) {
  const t = useTranslations('console.apiKeys')
  return (
    <div className="space-y-1">
      <p className="font-medium">{row.name}</p>
      <span className="break-all font-console-mono text-xs text-muted-foreground">{row.id}</span>
      <CopyConsoleId
        id={row.id}
        label={t('copyId')}
        copied={t('copied')}
        failed={t('copyFailed')}
      />
      <details className="text-xs text-muted-foreground">
        <summary>{t('scopes', { count: row.scopes.length })}</summary>
        <ul>
          {row.scopes.map((scope, index) => (
            <li key={`${scope}:${index}`} className="font-console-mono">
              {scope}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

export function ApiKeyOwner({ row, returnTo }: { row: AdminApiKey; returnTo: string }) {
  return (
    <ConsoleContextLink
      href={getConsoleUserDetailHref(row.owner.id, returnTo)}
      detailKey={`user:${row.owner.id}`}
      className="underline-offset-2 hover:underline"
    >
      {row.owner.name ?? row.owner.email}
      <span className="block text-xs text-muted-foreground">{row.owner.email}</span>
    </ConsoleContextLink>
  )
}

export function ApiKeyOrganization({ row, returnTo }: { row: AdminApiKey; returnTo: string }) {
  return (
    <ConsoleContextLink
      href={getConsoleOrganizationDetailHref(row.organization.id, returnTo)}
      detailKey={`organization:${row.organization.id}`}
      className="underline-offset-2 hover:underline"
    >
      {row.organization.name}
    </ConsoleContextLink>
  )
}

export function ApiKeyTime({ value, expiry = false }: { value: string | null; expiry?: boolean }) {
  const t = useTranslations('console.apiKeys')
  return value ? <ConsoleTimestamp value={value} /> : t(expiry ? 'noExpiry' : 'noUsage')
}
