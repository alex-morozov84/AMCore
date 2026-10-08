import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { inviteListQuerySchema, isOrganizationContextId } from '@amcore/shared'

import { OrganizationInvitationsClient } from '@/_pages/organization-invitations'
import { readOrganizationContext } from '@/entities/organization-context/index.server'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { redirectToLogin } from '@/shared/api/bff/dal'
import { SessionNotFoundError } from '@/shared/api/bff/errors'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'

import { safeOrganizationAdmission } from '../model/admission.server'
import {
  organizationAccessHrefs,
  type OrganizationAccessPlacement,
  organizationAccessPlacement,
} from '../model/placement'

import 'server-only'

export async function OrganizationInvitationsMount({
  id,
  searchParams = Promise.resolve({}),
  placement = organizationAccessPlacement,
}: {
  id: string
  searchParams?: Promise<Record<string, string | string[] | undefined>>
  placement?: OrganizationAccessPlacement
}) {
  if (!isOrganizationContextId(id)) notFound()
  let admission
  let initialOrganizationName: string
  try {
    admission = await safeOrganizationAdmission()
    const context = await readOrganizationContext(id, {
      headers: await headers(),
      expectedSession: admission.binding,
    })
    initialOrganizationName = context.data.organization.name
    if (!context.data.canManageTeamAccess) notFound()
  } catch (error) {
    if (
      error instanceof SessionNotFoundError ||
      (error instanceof ContextRequestError && error.status === 401)
    )
      return redirectToLogin()
    if (error instanceof ContextRequestError && [403, 404].includes(error.status)) notFound()
    if (error instanceof ContextRequestError && [429, 503, 504].includes(error.status))
      return <PrimaryUnavailableFallback reason="upstream" />
    throw error
  }
  const raw = await searchParams
  const parsed = inviteListQuerySchema.safeParse({ ...raw, limit: 20 })
  const invalidQuery =
    Object.keys(raw).some((key) => !['page', 'search', 'status'].includes(key)) || !parsed.success
  const query =
    !invalidQuery && parsed.success
      ? parsed.data
      : { page: 1, search: '', status: 'pending' as const }
  const hrefs = organizationAccessHrefs(placement)
  return (
    <OrganizationInvitationsClient
      admission={admission}
      organizationId={id}
      initialOrganizationName={initialOrganizationName}
      query={query}
      invalidQuery={invalidQuery}
      listHref={hrefs.listHref}
      backHref={hrefs.contextHref(id)}
      membersHref={hrefs.membersHref(id)}
      invitationsHref={hrefs.invitationsHref(id)}
      rolesHref={hrefs.rolesHref(id)}
    />
  )
}
