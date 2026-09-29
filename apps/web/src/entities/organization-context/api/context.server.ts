import {
  isOrganizationContextId,
  organizationContextResponseSchema,
  organizationListResponseSchema,
  type ProductAccessBootstrap,
} from '@amcore/shared'

import { withinContextDeadline } from '@/shared/api/bff/context-deadline'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import {
  type ContextExecutorInput,
  executeContextOperation,
} from '@/shared/api/bff/context-executor'
import { captureContextSession } from '@/shared/api/bff/context-session'
import { productContextDeps } from '@/shared/api/bff/product-context-deps'

import 'server-only'

export async function readOrganizationBootstrap(
  headers: Headers,
  signal?: AbortSignal
): Promise<ProductAccessBootstrap> {
  const deps = productContextDeps(headers)
  return withinContextDeadline(signal, async (operationSignal) => {
    const captured = await captureContextSession(await deps.readSessionId(), deps, undefined, true)
    operationSignal.throwIfAborted()
    return {
      binding: captured.binding,
      actor: { id: captured.entry.userSnapshot.id, email: captured.entry.userSnapshot.email },
    }
  })
}

export function readOrganizationList(page: number, input: ContextExecutorInput) {
  if (!Number.isSafeInteger(page) || page < 1 || (page - 1) * 20 > 2_147_483_647) {
    throw new ContextRequestError(400, 'BAD_REQUEST')
  }
  return executeContextOperation(
    {
      method: 'GET',
      path: `/api/v1/organizations?page=${page}&limit=20`,
      schema: organizationListResponseSchema,
    },
    input,
    productContextDeps(input.headers)
  )
}

export function readOrganizationContext(id: string, input: ContextExecutorInput) {
  if (!isOrganizationContextId(id)) throw new ContextRequestError(400, 'BAD_REQUEST')
  return executeContextOperation(
    {
      method: 'GET',
      path: `/api/v1/organizations/${id}/context`,
      organizationId: id,
      schema: organizationContextResponseSchema,
    },
    input,
    productContextDeps(input.headers)
  )
}
