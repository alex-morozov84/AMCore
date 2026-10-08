'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { ProductAccessBootstrap } from '@amcore/shared'

import { useOrganizationContext } from '@/entities/organization-context'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { BackLink } from '@/shared/ui/back-link'
import { Button } from '@/shared/ui/button'
import { PageTitle } from '@/shared/ui/page-title'
import { OrganizationInvitations } from '@/widgets/organization-invitations'
import { OrganizationSectionNav } from '@/widgets/organization-nav'

import { invitationListHref, type InvitationListView } from '../model/list-navigation'

/** Ready page uses ordinary destinations; custom designs consume the entity without this page. */
export function OrganizationInvitationsClient({
  admission,
  organizationId,
  initialOrganizationName,
  query,
  listHref,
  backHref,
  membersHref,
  invitationsHref,
  rolesHref,
  invalidQuery = false,
}: {
  admission: ProductAccessBootstrap
  organizationId: string
  initialOrganizationName?: string
  query: InvitationListView
  listHref: string
  backHref: string
  membersHref: string
  invitationsHref: string
  rolesHref?: string
  invalidQuery?: boolean
}) {
  const t = useTranslations('organizationInvitations')
  const accessT = useTranslations('organizationAccess')
  const locale = useLocale()
  const router = useRouteProgressRouter()
  const access = useOrganizationContext(admission.binding, {
    kind: 'selected',
    id: organizationId,
    locale,
  })
  const permissionDenied =
    access.state.status === 'ready' &&
    access.data &&
    'canManageTeamAccess' in access.data.data &&
    !access.data.data.canManageTeamAccess
  return (
    <section className="space-y-6">
      <BackLink href={listHref}>{t('allOrganizations')}</BackLink>
      <PageTitle>
        {access.data && 'organization' in access.data.data
          ? access.data.data.organization.name
          : access.initialPending
            ? initialOrganizationName
            : undefined}
      </PageTitle>
      <OrganizationSectionNav
        active="invitations"
        hrefs={{
          overview: backHref,
          members: membersHref,
          invitations: invitationsHref,
          roles: rolesHref,
        }}
      />
      {invalidQuery && <p role="status">{t('invalidQuery')}</p>}
      <ApiErrorAlert error={access.state.error} />
      {Boolean(access.state.error) && (
        <Button
          variant="outline"
          disabled={access.busy || access.state.status === 'pending'}
          onClick={() => {
            void access.refresh()
          }}
        >
          {t('retry')}
        </Button>
      )}
      {(access.state.status === 'missing' || access.state.status === 'changed') && (
        <div className="space-y-3" role="status">
          <p>
            {accessT(access.state.status === 'missing' ? 'missingGuidance' : 'changedGuidance')}
          </p>
          <Button
            onClick={() => {
              if (access.state.status === 'missing') router.push('/login')
              else window.location.reload()
            }}
          >
            {accessT(access.state.status === 'missing' ? 'signIn' : 'reload')}
          </Button>
        </div>
      )}
      <OrganizationInvitations
        key={`${admission.binding}:${organizationId}`}
        controller={access.controller}
        authorityStatus={permissionDenied ? 'denied' : access.state.status}
        query={query}
        onQueryChange={(next, reason) => {
          const href = invitationListHref(invitationsHref, next)
          if (reason === 'page') router.push(href, { scroll: false })
          else router.replace(href, { scroll: false })
        }}
      />
      <noscript>
        <p>{t('javascriptRequired')}</p>
      </noscript>
    </section>
  )
}
