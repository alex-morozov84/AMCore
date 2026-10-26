import { notFound } from 'next/navigation'
import { roleIdSchema } from '@amcore/shared'

import { OrganizationRoleClient } from '@/_pages/organization-role'
import { ClientMessages } from '@/i18n/client-message-boundary'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'

import { loadManagedOrganization } from '../model/managed-context.server'
import {
  organizationAccessHrefs,
  type OrganizationAccessPlacement,
  organizationAccessPlacement,
} from '../model/placement'

import 'server-only'

export async function OrganizationRoleMount({
  deniedContent,
  id,
  roleId,
  placement = organizationAccessPlacement,
}: {
  deniedContent?: React.ReactNode
  id: string
  roleId: string
  placement?: OrganizationAccessPlacement
}) {
  if (!roleIdSchema.safeParse(roleId).success) notFound()
  const loaded = await loadManagedOrganization(id, placement.loginHref ?? '/login', roleId)
  if (!loaded.ok) return <PrimaryUnavailableFallback reason="upstream" />
  const hrefs = organizationAccessHrefs(placement)
  return (
    <ClientMessages namespaces={['organizationRoles', 'organizationNav']}>
      <OrganizationRoleClient
        deniedContent={deniedContent}
        admission={loaded.admission}
        organizationId={id}
        roleId={roleId}
        initialOrganizationName={loaded.organizationName}
        hrefs={{
          overview: hrefs.contextHref(id),
          members: hrefs.membersHref(id),
          invitations: hrefs.invitationsHref(id),
          roles: hrefs.rolesHref(id),
        }}
      />
    </ClientMessages>
  )
}
