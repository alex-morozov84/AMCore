'use client'

import { useLocale } from 'next-intl'
import type { ProductAccessBootstrap } from '@amcore/shared'

import { OrganizationAccessClient } from '@/_pages/organization-access'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

import {
  organizationAccessHrefs,
  type OrganizationAccessPlacement,
  organizationAccessPlacement,
} from '../model/placement'

export function OrganizationAccessClientMount({
  admission,
  placement = organizationAccessPlacement,
  id,
  page,
  explicitList,
  initialOrganizationName,
  initialCanManageTeamAccess,
}: {
  admission: ProductAccessBootstrap
  placement?: OrganizationAccessPlacement
  id?: string
  page: number
  explicitList: boolean
  initialOrganizationName?: string
  initialCanManageTeamAccess?: boolean
}) {
  const router = useRouteProgressRouter()
  const locale = useLocale()
  const hrefs = organizationAccessHrefs(placement)
  return (
    <OrganizationAccessClient
      admission={admission}
      initialOrganizationName={initialOrganizationName}
      initialCanManageTeamAccess={initialCanManageTeamAccess}
      input={id ? { kind: 'selected', id, locale } : { kind: 'list', page, locale }}
      explicitList={explicitList}
      membersHref={hrefs.membersHref}
      invitationsHref={hrefs.invitationsHref}
      rolesHref={hrefs.rolesHref}
      contextHref={hrefs.contextHref}
      pageHref={hrefs.pageHref}
      listHref={hrefs.listHref}
      loginHref="/login"
      dashboardHref={hrefs.homeHref}
      onReplace={(href) => router.replace(href)}
      onReload={() => window.location.reload()}
    />
  )
}
