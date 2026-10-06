import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { isOrganizationContextId } from '@amcore/shared'

import { readOrganizationContext } from '@/entities/organization-context/index.server'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { redirectToLogin } from '@/shared/api/bff/dal'
import { SessionNotFoundError } from '@/shared/api/bff/errors'

import { safeOrganizationAdmission } from '../model/admission.server'
import { type OrganizationAccessPlacement, organizationAccessPlacement } from '../model/placement'

import { OrganizationAccessClientMount } from './mount-client'

import 'server-only'

export async function OrganizationAccessMount({
  id,
  searchParams,
  placement = organizationAccessPlacement,
}: {
  id?: string
  placement?: OrganizationAccessPlacement
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (id !== undefined && !isOrganizationContextId(id)) notFound()
  let admission
  let initialOrganizationName: string | undefined
  let initialCanManageTeamAccess = false
  try {
    admission = await safeOrganizationAdmission()
    if (id) {
      const context = await readOrganizationContext(id, {
        headers: await headers(), expectedSession: admission.binding,
      })
      initialOrganizationName = context.data.organization.name
      initialCanManageTeamAccess = context.data.canManageTeamAccess
    }
  } catch (error) {
    if (
      error instanceof SessionNotFoundError ||
      (error instanceof ContextRequestError && error.status === 401)
    ) {
      return redirectToLogin()
    }
    if (error instanceof ContextRequestError && [403, 404].includes(error.status)) notFound()
    throw error
  }
  const search = await searchParams
  const requested = typeof search.page === 'string' ? Number(search.page) : 1
  const page =
    Number.isSafeInteger(requested) && requested >= 1 && (requested - 1) * 20 <= 2_147_483_647
      ? requested
      : 1
  return (
    <OrganizationAccessClientMount
      placement={placement}
      admission={admission}
      id={id}
      initialOrganizationName={initialOrganizationName}
      initialCanManageTeamAccess={initialCanManageTeamAccess}
      page={page}
      explicitList={search.view === 'list'}
    />
  )
}
