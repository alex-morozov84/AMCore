import { getTranslations } from 'next-intl/server'

import {
  getConsoleAuditHref,
  getConsoleOrganizationsHref,
  getConsoleUsersHref,
} from '@/shared/lib/console-public-href'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

import { CopyConsoleId } from './CopyConsoleId'

export async function DetailBackLink({
  returnTo,
  kind,
}: {
  returnTo: string | null
  kind: 'user' | 'organization'
}) {
  const t = await getTranslations('console.detail')
  const fallback = kind === 'user' ? getConsoleUsersHref() : getConsoleOrganizationsHref()
  const href = returnTo ?? fallback
  const label =
    returnTo?.split('?')[0] === getConsoleAuditHref()
      ? t('backAudit')
      : kind === 'user'
        ? t('backUsers')
        : t('backOrganizations')
  return (
    <RouteProgressLink
      prefetch={false}
      href={href}
      className="text-sm text-muted-foreground underline-offset-2 hover:underline focus-visible:underline"
    >
      ← {label}
    </RouteProgressLink>
  )
}

export async function DetailId({ id }: { id: string }) {
  const t = await getTranslations('console.detail')
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <span>{t('id')}:</span>
      <span className="truncate font-console-mono" title={id}>
        {id}
      </span>
      <CopyConsoleId id={id} label={t('copyId')} copied={t('copied')} failed={t('copyFailed')} />
    </div>
  )
}

export function DetailFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium">{children}</dd>
    </div>
  )
}
