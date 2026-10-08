'use client'
import { useLocale, useTranslations } from 'next-intl'
import type { ProductAccessBootstrap } from '@amcore/shared'

import { useOrganizationContext } from '@/entities/organization-context'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { BackLink } from '@/shared/ui/back-link'
import { Button } from '@/shared/ui/button'
import { PageTitle } from '@/shared/ui/page-title'
import { OrganizationSectionNav } from '@/widgets/organization-nav'
import { OrganizationRoles } from '@/widgets/organization-roles'

import { roleListHref, type RoleListView } from '../model/role-list-navigation'

export function OrganizationRolesClient({
  admission,
  organizationId,
  initialOrganizationName,
  hrefs,
  listHref,
  query,
}: {
  admission: ProductAccessBootstrap
  organizationId: string
  initialOrganizationName?: string
  hrefs: React.ComponentProps<typeof OrganizationSectionNav>['hrefs'] & { roles: string }
  listHref: string
  query: RoleListView
}) {
  const router = useRouteProgressRouter()
  // A role page is the child route of the roles tab; strings (not functions) cross the server boundary.
  const roleHref = (roleId: string) => `${hrefs.roles}/${encodeURIComponent(roleId)}`
  const locale = useLocale()
  const t = useTranslations('organizationRoles')
  const access = useOrganizationContext(admission.binding, {
    kind: 'selected',
    id: organizationId,
    locale,
  })
  const allowed =
    access.data && 'canManageTeamAccess' in access.data.data && access.data.data.canManageTeamAccess
  const name =
    access.data && 'organization' in access.data.data
      ? access.data.data.organization.name
      : access.initialPending
        ? initialOrganizationName
        : undefined
  return (
    <section className="space-y-6">
      <BackLink href={listHref}>{t('backToOrganizations')}</BackLink>
      <PageTitle>{name}</PageTitle>
      <OrganizationSectionNav active="roles" hrefs={hrefs} />
      <ApiErrorAlert error={access.state.error} />
      {access.state.status === 'ready' && !allowed ? (
        <p role="status">{t('denied')}</p>
      ) : (
        <OrganizationRoles
          key={`${admission.binding}:${organizationId}`}
          controller={access.controller}
          query={query}
          roleHref={roleHref}
          onOpenRole={(roleId) => router.push(roleHref(roleId))}
          onQueryChange={(next, reason) => {
            const href = roleListHref(hrefs.roles, next)
            if (reason === 'page') router.push(href, { scroll: false })
            else router.replace(href, { scroll: false })
          }}
        />
      )}
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
