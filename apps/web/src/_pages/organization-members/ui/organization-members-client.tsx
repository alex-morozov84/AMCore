'use client'
import { useLocale, useTranslations } from 'next-intl'
import type { ProductAccessBootstrap } from '@amcore/shared'

import { useOrganizationContext } from '@/entities/organization-context'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { BackLink } from '@/shared/ui/back-link'
import { Button } from '@/shared/ui/button'
import { SectionNavigation } from '@/shared/ui/section-navigation'
import { OrganizationMembers } from '@/widgets/organization-members'

import { memberListHref, type MemberListView } from '../model/member-list-navigation'

export function OrganizationMembersClient({
  admission,
  organizationId,
  backHref,
  membersHref,
  listHref,
  query,
}: {
  admission: ProductAccessBootstrap
  organizationId: string
  backHref: string
  membersHref?: string
  listHref?: string
  query?: MemberListView
}) {
  const router = useRouteProgressRouter()
  const locale = useLocale()
  const t = useTranslations('organizationMembers')
  const input = { kind: 'selected' as const, id: organizationId, locale }
  const access = useOrganizationContext(admission.binding, input)
  const allowed =
    access.data && 'canManageTeamAccess' in access.data.data && access.data.data.canManageTeamAccess
  return (
    <section className="space-y-6">
      <BackLink href={listHref ?? backHref}>{t('allOrganizations')}</BackLink>
      {access.data && 'organization' in access.data.data && (
        <h1 className="break-words text-2xl font-semibold tracking-tight">
          {access.data.data.organization.name}
        </h1>
      )}
      <SectionNavigation
        label={t('sections')}
        items={[
          { label: t('overview'), href: backHref, active: false },
          { label: t('title'), href: membersHref ?? `${backHref}/members`, active: true },
        ]}
      />
      <ApiErrorAlert error={access.state.error} />
      <OrganizationMembers
        key={`${admission.binding}:${organizationId}`}
        controller={access.controller}
        actorId={admission.actor.id}
        authorityStatus={access.state.status}
        query={query}
        onQueryChange={
          membersHref
            ? (next, reason) => {
                const href = memberListHref(membersHref, next)
                if (reason === 'page') router.push(href, { scroll: false })
                else router.replace(href, { scroll: false })
              }
            : undefined
        }
      />
      {access.state.status === 'ready' && !allowed && <p role="status">{t('denied')}</p>}
      {Boolean(access.state.error) && (
        <Button
          variant="outline"
          disabled={access.state.status === 'pending' || access.busy}
          onClick={() => void access.refresh()}
        >
          {t('retry')}
        </Button>
      )}
    </section>
  )
}
