'use client'
import { useLocale, useTranslations } from 'next-intl'
import type { ProductAccessBootstrap } from '@amcore/shared'

import { useOrganizationContext } from '@/entities/organization-context'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { BackLink } from '@/shared/ui/back-link'
import { Button } from '@/shared/ui/button'
import { PageTitle } from '@/shared/ui/page-title'
import { SectionNavigation } from '@/shared/ui/section-navigation'
import { OrganizationMembers } from '@/widgets/organization-members'

import { memberListHref, type MemberListView } from '../model/member-list-navigation'

export function OrganizationMembersClient({
  admission,
  organizationId,
  initialOrganizationName,
  backHref,
  membersHref,
  invitationsHref,
  listHref,
  query,
}: {
  admission: ProductAccessBootstrap
  organizationId: string
  initialOrganizationName?: string
  backHref: string
  membersHref?: string
  invitationsHref?: string
  listHref?: string
  query?: MemberListView
}) {
  const router = useRouteProgressRouter()
  const locale = useLocale()
  const t = useTranslations('organizationMembers')
  const invitesT = useTranslations('organizationInvitations')
  const input = { kind: 'selected' as const, id: organizationId, locale }
  const access = useOrganizationContext(admission.binding, input)
  const allowed =
    access.data && 'canManageTeamAccess' in access.data.data && access.data.data.canManageTeamAccess
  return (
    <section className="space-y-6">
      <BackLink href={listHref ?? backHref}>{t('allOrganizations')}</BackLink>
      <PageTitle>{access.data && 'organization' in access.data.data ? access.data.data.organization.name : access.initialPending ? initialOrganizationName : undefined}</PageTitle>
      <SectionNavigation
        label={t('sections')}
        items={[
          { label: t('overview'), href: backHref, active: false },
          { label: t('title'), href: membersHref ?? `${backHref}/members`, active: true },
          ...(invitationsHref ? [{ label: invitesT('title'), href: invitationsHref, active: false }] : []),
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
