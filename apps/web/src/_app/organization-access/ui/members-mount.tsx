import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import {
  isOrganizationContextId,
  memberIdSchema,
  organizationMembersQuerySchema,
} from '@amcore/shared'
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'

import { OrganizationMembersClient } from '@/_pages/organization-members'
import {
  organizationContextKey,
  organizationReadKey,
  readOrganizationContext,
  readOrganizationMembers,
} from '@/entities/organization-context/index.server'
import { ClientMessages } from '@/i18n/client-message-boundary'
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
  if (!isOrganizationContextId(id)) notFound()
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
  const cache = new QueryClient()
  let admission
  let initialOrganizationName: string
  try {
    admission = await safeOrganizationAdmission()
    const request = { headers: await headers(), expectedSession: admission.binding }
    const context = await readOrganizationContext(id, request)
    initialOrganizationName = context.data.organization.name
    if (!context.data.canManageTeamAccess) notFound()
    cache.setQueryData(
      organizationContextKey(admission.binding, {
        kind: 'selected',
        id,
        locale: await getLocale(),
      }),
      context
    )
    const members = await readOrganizationMembers(id, { ...query, limit: 20 }, request)
    cache.setQueryData(
      organizationReadKey('organization-members', JSON.stringify([admission.binding, id, query])),
      members.data
    )
  } catch (error) {
    if (
      error instanceof SessionNotFoundError ||
      (error instanceof ContextRequestError && error.status === 401)
    )
      return redirectToLogin(placement.loginHref ?? '/login')
    if (error instanceof ContextRequestError && [403, 404].includes(error.status)) notFound()
    throw error
  }
  return (
    <HydrationBoundary state={dehydrate(cache)}>
      <ClientMessages
        namespaces={[
          'organizationMembers',
          'organizationRoles',
          'memberAccess',
          'memberApiKeys',
          'memberRemoval',
          'apiKeyPresentation',
          'organizationNav',
        ]}
      >
        <OrganizationMembersClient
          deniedContent={deniedContent}
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
      </ClientMessages>
    </HydrationBoundary>
  )
}
