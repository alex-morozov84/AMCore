import { headers } from 'next/headers'
import { OWN_KEY_QUERY_BYTES, ownKeyQuerySchema } from '@amcore/shared'

import { OwnApiKeysPage } from '@/_pages/own-api-keys'
import { readOwnApiKeyAdmission } from '@/entities/api-key/index.server'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { redirectToLogin } from '@/shared/api/bff/dal'
import {
  isInvalidRefreshError,
  SessionNotFoundError,
  SessionRefreshUnsafeError,
} from '@/shared/api/bff/errors'

import { type OrganizationAccessPlacement, organizationAccessPlacement } from '../model/placement'

import 'server-only'

export async function OwnApiKeysMount({
  searchParams,
  placement = organizationAccessPlacement,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
  placement?: OrganizationAccessPlacement
}) {
  let admission
  try {
    admission = await readOwnApiKeyAdmission(await headers())
  } catch (error) {
    if (
      error instanceof SessionNotFoundError ||
      error instanceof SessionRefreshUnsafeError ||
      isInvalidRefreshError(error) ||
      (error instanceof ContextRequestError && error.status === 401)
    )
      return redirectToLogin()
    throw error
  }
  const search = await searchParams
  const params = new URLSearchParams()
  let duplicate = false
  for (const [key, value] of Object.entries(search)) {
    if (Array.isArray(value)) duplicate = true
    else if (value !== undefined) params.set(key, value)
  }
  const parsed = ownKeyQuerySchema.safeParse(Object.fromEntries(params))
  const invalidQuery =
    (params.has('limit') && params.get('limit') !== '20') ||
    duplicate ||
    new TextEncoder().encode(params.toString()).length > OWN_KEY_QUERY_BYTES ||
    !parsed.success
  const query = parsed.success ? parsed.data : { page: 1, limit: 20, status: 'all' as const }
  return (
    <OwnApiKeysPage
      admission={admission}
      query={query}
      invalidQuery={invalidQuery}
      baseHref={placement.ownApiKeysPath ?? '/settings/api-keys'}
    />
  )
}
