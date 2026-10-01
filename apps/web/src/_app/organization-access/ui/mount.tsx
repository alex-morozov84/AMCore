import { notFound } from 'next/navigation'
import { isOrganizationContextId } from '@amcore/shared'

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
  try {
    admission = await safeOrganizationAdmission()
  } catch (error) {
    if (
      error instanceof SessionNotFoundError ||
      (error instanceof ContextRequestError && error.status === 401)
    ) {
      return redirectToLogin()
    }
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
      page={page}
      explicitList={search.view === 'list'}
    />
  )
}
