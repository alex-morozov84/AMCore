import {
  isOrganizationContextId,
  memberRemovalCommandSchema,
  memberRemovalResultSchema,
} from '@amcore/shared'

import { ContextRequestError } from '@/shared/api/bff/context-errors'
import {
  type ContextExecutorInput,
  executeContextOperation,
} from '@/shared/api/bff/context-executor'
import { productContextDeps } from '@/shared/api/bff/product-context-deps'

import 'server-only'

export function removeOrganizationMember(
  orgId: string,
  userId: string,
  raw: unknown,
  input: ContextExecutorInput
) {
  const query = memberRemovalCommandSchema.safeParse(raw)
  if (!query.success || ![orgId, userId].every(isOrganizationContextId))
    throw new ContextRequestError(400, 'BAD_REQUEST')
  const params = new URLSearchParams(query.data)
  return executeContextOperation(
    {
      method: 'DELETE',
      path: `/api/v1/organizations/${orgId}/members/${userId}?${params}`,
      organizationId: orgId,
      bodyMode: 'empty',
      successStatus: 204,
      acknowledgment: { removed: true as const },
      schema: memberRemovalResultSchema,
      timeoutMs: 15000,
    },
    input,
    productContextDeps(input.headers)
  )
}
