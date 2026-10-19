import {
  isOrganizationContextId,
  OWN_KEY_API_BYTES,
  OWN_KEY_ENVELOPE_BYTES,
  OWN_KEY_REQUEST_BYTES,
  ownKeyCreatedSchema,
  ownKeyCreateSchema,
  ownKeyListSchema,
  ownKeyOrganizationsQuerySchema,
  ownKeyOrganizationsSchema,
  ownKeyQuerySchema,
  ownKeyRevokedSchema,
} from '@amcore/shared'

import { withinContextDeadline } from '@/shared/api/bff/context-deadline'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import {
  type ContextExecutorInput,
  executeContextOperation,
} from '@/shared/api/bff/context-executor'
import { captureContextSession, freshContextSession } from '@/shared/api/bff/context-session'
import { productContextDeps } from '@/shared/api/bff/product-context-deps'

import 'server-only'

const bounds = {
  responseBytes: OWN_KEY_API_BYTES,
  envelopeBytes: OWN_KEY_ENVELOPE_BYTES,
  timeoutMs: 15000,
} as const
function parsed<T>(result: { success: true; data: T } | { success: false }): T {
  if (!result.success) throw new ContextRequestError(400, 'BAD_REQUEST')
  return result.data
}
export async function readOwnApiKeys(raw: unknown, input: ContextExecutorInput) {
  const query = parsed(ownKeyQuerySchema.safeParse(raw))
  const params = new URLSearchParams(
    Object.entries(query)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)])
  )
  return executeContextOperation(
    {
      ...bounds,
      method: 'GET',
      path: `/api/v1/api-keys?${params}`,
      schema: ownKeyListSchema,
      successStatus: 200,
    },
    input,
    productContextDeps(input.headers)
  )
}
export async function createOwnApiKey(raw: unknown, input: ContextExecutorInput) {
  const body = parsed(ownKeyCreateSchema.safeParse(raw))
  return executeContextOperation(
    {
      ...bounds,
      method: 'POST',
      path: '/api/v1/api-keys',
      body,
      requestBytes: OWN_KEY_REQUEST_BYTES,
      schema: ownKeyCreatedSchema,
      successStatus: 201,
    },
    input,
    productContextDeps(input.headers)
  )
}
export async function revokeOwnApiKey(id: string, input: ContextExecutorInput) {
  if (!isOrganizationContextId(id)) throw new ContextRequestError(400, 'BAD_REQUEST')
  return executeContextOperation(
    {
      ...bounds,
      method: 'DELETE',
      path: `/api/v1/api-keys/${id}`,
      bodyMode: 'empty',
      schema: ownKeyRevokedSchema,
      acknowledgment: { revoked: true },
      successStatus: 204,
    },
    input,
    productContextDeps(input.headers)
  )
}
export async function readOwnApiKeyAdmission(headers: Headers) {
  const deps = productContextDeps(headers)
  return withinContextDeadline(undefined, async (signal) => {
    const captured = await captureContextSession(await deps.readSessionId(), deps, undefined, true)
    await freshContextSession(captured, deps)
    signal.throwIfAborted()
    return { binding: captured.binding, actorId: captured.entry.userSnapshot.id }
  })
}
export async function verifyOwnApiKeySession(input: ContextExecutorInput) {
  const deps = productContextDeps(input.headers)
  return withinContextDeadline(input.signal, async (signal) => {
    const captured = await captureContextSession(
      await deps.readSessionId(),
      deps,
      input.expectedSession
    )
    await freshContextSession(captured, deps)
    signal.throwIfAborted()
    return { binding: captured.binding, data: { verified: true as const } }
  })
}

export async function readOwnKeyOrganizations(raw: unknown, input: ContextExecutorInput) {
  const q = parsed(ownKeyOrganizationsQuerySchema.safeParse(raw))
  const params = new URLSearchParams(
    Object.entries(q)
      .filter(([, value]) => value !== undefined)
      .map(([k, v]) => [k, String(v)])
  )
  return executeContextOperation(
    {
      ...bounds,
      responseBytes: 32768,
      envelopeBytes: 36864,
      method: 'GET',
      path: `/api/v1/api-keys/organizations?${params}`,
      schema: ownKeyOrganizationsSchema,
      successStatus: 200,
    },
    input,
    productContextDeps(input.headers)
  )
}
