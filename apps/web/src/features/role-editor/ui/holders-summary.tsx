'use client'
import { useTranslations } from 'next-intl'
import type { RoleDefinitionDetail } from '@amcore/shared'

/** Who is affected by edits to this role: a bounded sample, the total and pending invitations. */
export function HoldersSummary({ detail }: { detail: RoleDefinitionDetail }) {
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
              {holder.name ?? holder.email}
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
      {impact.liveInvitationCount > 0 && (
        <p className="text-sm">{t('invitationsLive', { count: impact.liveInvitationCount })}</p>
      )}
    </section>
  )
}
