import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import {
  isOrganizationContextId,
  memberIdSchema,
  organizationMembersQuerySchema,
} from '@amcore/shared'

import { OrganizationMembersClient } from '@/_pages/organization-members'
import { readOrganizationContext } from '@/entities/organization-context/index.server'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { redirectToLogin } from '@/shared/api/bff/dal'
import { SessionNotFoundError } from '@/shared/api/bff/errors'

import { safeOrganizationAdmission } from '../model/admission.server'
import {
  organizationAccessHrefs,
  type OrganizationAccessPlacement,
  organizationAccessPlacement,
} from '../model/placement'

import 'server-only'

export async function OrganizationMembersMount({
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
    throw error
  }
  const raw = await searchParams
  const parsed = organizationMembersQuerySchema.safeParse({
    page: raw.page,
    search: raw.search,
    limit: 20,
  })
  const role = memberIdSchema.safeParse(raw.role)
  const query = {
    ...(parsed.success
      ? { page: parsed.data.page, search: parsed.data.search ?? '' }
      : { page: 1, search: '' }),
    ...(role.success ? { roleId: role.data } : {}),
  }
  return (
    <OrganizationMembersClient
      admission={admission}
      organizationId={id}
      initialOrganizationName={initialOrganizationName}
      query={query}
      backHref={organizationAccessHrefs(placement).contextHref(id)}
      membersHref={organizationAccessHrefs(placement).membersHref(id)}
      invitationsHref={organizationAccessHrefs(placement).invitationsHref(id)}
      rolesHref={organizationAccessHrefs(placement).rolesHref(id)}
      listHref={organizationAccessHrefs(placement).listHref}
    />
  )
}
