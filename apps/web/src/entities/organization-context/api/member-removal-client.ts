import { memberRemovalCommandSchema, memberRemovalResultSchema } from '@amcore/shared'

import { parseContextResponse } from '@/shared/api/context-response'
import { ApiRequestError } from '@/shared/api/http-client'
import { parseRetryAfterSeconds } from '@/shared/api/retry-after'

import 'client-only'

const rejectionPairs: Record<number, readonly string[]> = {
  400: ['BUSINESS_RULE_VIOLATION', 'BAD_REQUEST', 'VALIDATION_ERROR'],
  401: ['UNAUTHORIZED', 'TOKEN_INVALID'],
  403: ['FORBIDDEN', 'MEMBER_ROLE_ASSIGNMENT_DENIED', 'AUTH_ORIGIN_REJECTED'],
  404: ['RESOURCE_NOT_FOUND'],
  409: [
    'MEMBER_ROLES_CONFLICT',
    'MEMBER_API_KEYS_CONFLICT',
    'MEMBER_API_KEYS_LIMIT',
    'CONTEXT_SESSION_CHANGED',
  ],
  413: ['PAYLOAD_TOO_LARGE'],
  429: ['RATE_LIMIT_EXCEEDED'],
}
export const memberRemovalRejectionCodes = new Set(Object.values(rejectionPairs).flat())
export function removalFailure(status: number, body: unknown, headers: Headers): Error {
  const error = new ApiRequestError(status, body as never, parseRetryAfterSeconds(headers))
  return error.body?.errorCode && rejectionPairs[status]?.includes(error.body.errorCode)
    ? error
    : new Error('MEMBER_REMOVAL_UNCONFIRMED', { cause: error })
}
export async function removeMember(
  binding: string,
  orgId: string,
  userId: string,
  expectedMemberId: string,
  signal: AbortSignal
) {
  const query = new URLSearchParams(memberRemovalCommandSchema.parse({ expectedMemberId }))
  const result = await fetch(
    `/api/product-access/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}?${query}`,
    {
      method: 'DELETE',
      signal,
      headers: { 'X-AMCore-Context-Session': binding },
    }
  )
  const body: unknown = await result.json().catch(() => undefined)
  if (!result.ok) throw removalFailure(result.status, body, result.headers)
  if (result.status !== 200) throw new Error('INVALID_WRITE_ACKNOWLEDGMENT')
  return parseContextResponse(binding, memberRemovalResultSchema, body)
}
