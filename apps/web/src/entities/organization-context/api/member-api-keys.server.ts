import {
  isOrganizationContextId,
  MEMBER_KEY_API_BYTES,
  MEMBER_KEY_ENVELOPE_BYTES,
  MEMBER_KEY_REQUEST_BYTES,
  memberKeyCommandSchema,
  memberKeyListSchema,
  memberKeyQuerySchema,
  memberKeyResultSchema,
} from '@amcore/shared'

import { ContextRequestError } from '@/shared/api/bff/context-errors'
import {
  type ContextExecutorInput,
  executeContextOperation,
} from '@/shared/api/bff/context-executor'
import { productContextDeps } from '@/shared/api/bff/product-context-deps'

import 'server-only'

function path(orgId: string, userId: string, keyId?: string) {
  if (![orgId, userId, ...(keyId ? [keyId] : [])].every(isOrganizationContextId))
    throw new ContextRequestError(400, 'BAD_REQUEST')
  return `/api/v1/organizations/${orgId}/members/${userId}/api-keys`
}
export function readMemberKeys(
  orgId: string,
  userId: string,
  raw: unknown,
  input: ContextExecutorInput
) {
  const q = memberKeyQuerySchema.safeParse(raw)
  if (!q.success) throw new ContextRequestError(400, 'BAD_REQUEST')
  const params = new URLSearchParams(Object.entries(q.data).map(([k, v]) => [k, String(v)]))
  return executeContextOperation(
    {
      method: 'GET',
      path: `${path(orgId, userId)}?${params}`,
      organizationId: orgId,
      schema: memberKeyListSchema,
      successStatus: 200,
      responseBytes: MEMBER_KEY_API_BYTES,
      envelopeBytes: MEMBER_KEY_ENVELOPE_BYTES,
      timeoutMs: 15000,
    },
    input,
    productContextDeps(input.headers)
  )
}
export function revokeMemberKeys(
  orgId: string,
  userId: string,
  raw: unknown,
  input: ContextExecutorInput,
  keyId?: string
) {
  const body = memberKeyCommandSchema.safeParse(raw)
  if (!body.success) throw new ContextRequestError(400, 'BAD_REQUEST')
  const suffix = keyId ? `${keyId}/revoke` : 'revoke-all'
  return executeContextOperation(
    {
      method: 'POST',
      path: `${path(orgId, userId, keyId)}/${suffix}`,
      organizationId: orgId,
      body: body.data,
      schema: memberKeyResultSchema,
      successStatus: 200,
      requestBytes: MEMBER_KEY_REQUEST_BYTES,
      responseBytes: MEMBER_KEY_API_BYTES,
      envelopeBytes: MEMBER_KEY_ENVELOPE_BYTES,
      timeoutMs: 15000,
    },
    input,
    productContextDeps(input.headers)
  )
}
