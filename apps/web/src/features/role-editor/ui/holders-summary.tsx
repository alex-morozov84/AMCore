'use client'
import { useTranslations } from 'next-intl'
import type { RoleDefinitionDetail } from '@amcore/shared'

import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

/** Who is affected by edits to this role: a bounded sample, the total and pending invitations. */
export function HoldersSummary({
  detail,
  holderHref,
  allHoldersHref,
}: {
  detail: RoleDefinitionDetail
  /** Where a person's roles are changed; the role page itself never edits memberships. */
  holderHref?: (email: string) => string
  /** The full, searchable list lives on the Members tab, narrowed to this role. */
  allHoldersHref?: string
}) {
  const t = useTranslations('organizationRoles')
  const { holders, impact } = detail
  return (
    <section aria-labelledby="role-holders-title" className="space-y-2">
      <h3 id="role-holders-title" className="text-base font-semibold">
        {t('holdersTitle')}
      </h3>
      <p className="text-sm text-muted-foreground">{t('holdersCount', { count: holders.total })}</p>
      {holders.sample.length === 0 ? (
        <p className="text-sm">{t('holdersEmpty')}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {holders.sample.map((holder) => (
            <li key={holder.memberId} className="break-words">
              {holderHref ? (
                <RouteProgressLink
                  href={holderHref(holder.email)}
                  aria-label={t('holderOpen', { name: holder.name ?? holder.email })}
                  className="underline-offset-4 hover:underline"
                >
                  {holder.name ?? holder.email}
                </RouteProgressLink>
              ) : (
                (holder.name ?? holder.email)
              )}
              {holder.name && <span className="text-muted-foreground"> · {holder.email}</span>}
            </li>
          ))}
        </ul>
      )}
      {holders.truncated && (
        <p className="text-sm text-muted-foreground">
          {t('holdersMore', { count: holders.total - holders.sample.length })}
        </p>
      )}
      {allHoldersHref && holders.total > 0 && (
        <Button
          variant="outline"
          nativeButton={false}
          render={<RouteProgressLink href={allHoldersHref} />}
        >
          {t('holdersViewAll', { count: holders.total })}
        </Button>
      )}
      {impact.liveInvitationCount > 0 && (
        <Alert variant="warning">
          <AlertDescription>
            <p className="font-medium text-card-foreground">
              {t('invitationsLive', { count: impact.liveInvitationCount })}
            </p>
            <p>{t('invitationsLiveHint')}</p>
          </AlertDescription>
        </Alert>
      )}
    </section>
  )
}
