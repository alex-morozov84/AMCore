import {
  type MemberKeyCommand,
  memberKeyCommandSchema,
  memberKeyListSchema,
  type MemberKeyQuery,
  memberKeyQuerySchema,
  memberKeyResultSchema,
} from '@amcore/shared'

import { parseContextResponse } from '@/shared/api/context-response'
import { ApiRequestError } from '@/shared/api/http-client'
import { parseRetryAfterSeconds } from '@/shared/api/retry-after'

import 'client-only'

function path(orgId: string, userId: string) {
  return `/api/product-access/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}/api-keys`
}
async function response(
  binding: string,
  url: string,
  signal: AbortSignal,
  body?: MemberKeyCommand
) {
  const result = await fetch(url, {
    method: body ? 'POST' : 'GET',
    signal,
    headers: {
      'X-AMCore-Context-Session': binding,
      ...(body && { 'Content-Type': 'application/json' }),
    },
    ...(body && { body: JSON.stringify(memberKeyCommandSchema.parse(body)) }),
  })
  const json: unknown = await result.json().catch(() => undefined)
  if (!result.ok)
    throw new ApiRequestError(result.status, json as never, parseRetryAfterSeconds(result.headers))
  if (result.status !== 200) throw new Error('INVALID_WRITE_ACKNOWLEDGMENT')
  return json
}
export const memberKeysClient = {
  async list(
    binding: string,
    orgId: string,
    userId: string,
    query: MemberKeyQuery,
    signal: AbortSignal
  ) {
    const q = memberKeyQuerySchema.parse(query)
    const params = new URLSearchParams(
      Object.entries(q).map(([key, value]) => [key, String(value)])
    )
    return parseContextResponse(
      binding,
      memberKeyListSchema,
      await response(binding, `${path(orgId, userId)}?${params}`, signal)
    )
  },
  async revoke(
    binding: string,
    orgId: string,
    userId: string,
    body: MemberKeyCommand,
    signal: AbortSignal,
    keyId?: string
  ) {
    const suffix = keyId ? `${encodeURIComponent(keyId)}/revoke` : 'revoke-all'
    return parseContextResponse(
      binding,
      memberKeyResultSchema,
      await response(binding, `${path(orgId, userId)}/${suffix}`, signal, body)
    )
  },
}
