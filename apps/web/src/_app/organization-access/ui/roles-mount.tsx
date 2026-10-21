import { OrganizationRolesClient } from '@/_pages/organization-roles'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'

import { loadManagedOrganization } from '../model/managed-context.server'
import {
  organizationAccessHrefs,
  type OrganizationAccessPlacement,
  organizationAccessPlacement,
} from '../model/placement'
import { organizationRoleListQuery } from '../model/role-list-query'

import 'server-only'

export async function OrganizationRolesMount({
  deniedContent,
  id,
  searchParams = Promise.resolve({}),
  placement = organizationAccessPlacement,
}: {
  deniedContent?: React.ReactNode
  id: string
  searchParams?: Promise<Record<string, string | string[] | undefined>>
  placement?: OrganizationAccessPlacement
}) {
  const loaded = await loadManagedOrganization(id, placement.loginHref ?? '/login')
  if (!loaded.ok) return <PrimaryUnavailableFallback reason="upstream" />
  const hrefs = organizationAccessHrefs(placement)
  return (
    <OrganizationRolesClient
      deniedContent={deniedContent}
      admission={loaded.admission}
      organizationId={id}
      initialOrganizationName={loaded.organizationName}
      query={organizationRoleListQuery(await searchParams)}
      listHref={hrefs.listHref}
      hrefs={{
        overview: hrefs.contextHref(id),
        members: hrefs.membersHref(id),
        invitations: hrefs.invitationsHref(id),
        roles: hrefs.rolesHref(id),
      }}
    />
  )
}
