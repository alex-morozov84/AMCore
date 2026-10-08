import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { isOrganizationContextId } from '@amcore/shared'

import { readOrganizationContext } from '@/entities/organization-context/index.server'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { redirectToLogin } from '@/shared/api/bff/dal'
import { SessionNotFoundError } from '@/shared/api/bff/errors'

import { safeOrganizationAdmission } from './admission.server'

import 'server-only'

/**
 * The server-side gate of a team-access page: a valid id, a session, and an organization the
 * caller may manage. Sign-in and not-found are handled here; a temporarily unavailable upstream
 * is returned so the mount can render its own fallback.
 */
export async function loadManagedOrganization(id: string) {
  if (!isOrganizationContextId(id)) notFound()
  try {
    const admission = await safeOrganizationAdmission()
    const context = await readOrganizationContext(id, {
      headers: await headers(),
      expectedSession: admission.binding,
    })
    if (!context.data.canManageTeamAccess) notFound()
    return { ok: true as const, admission, organizationName: context.data.organization.name }
  } catch (error) {
    if (
      error instanceof SessionNotFoundError ||
      (error instanceof ContextRequestError && error.status === 401)
    )
      return redirectToLogin()
    if (error instanceof ContextRequestError && [403, 404].includes(error.status)) notFound()
    if (error instanceof ContextRequestError && [429, 503, 504].includes(error.status))
      return { ok: false as const }
    throw error
  }
}
