import { invitationOperationIdSchema, isOrganizationContextId, serializedJsonBytes } from '@amcore/shared'
import type { ZodType } from 'zod'

import { parseRetryAfterSeconds } from '../retry-after'

import { readContextJson } from './context-body-budget'
import { withinContextDeadline } from './context-deadline'
import { ContextRequestError } from './context-errors'
import {
  captureContextSession,
  freshContextSession,
  validateExpectedContextSession,
} from './context-session'
import type { EnsureFreshSessionDeps } from './ensure-fresh-session'
import { forwardRequestHeaders } from './proxy-headers'
import { resolveTrustedClientIp } from './trusted-client-ip'

import 'server-only'

/** Code-owned operation. Route inputs never supply this descriptor or an arbitrary URL. */
interface ContextOperationBase {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  readonly path: string
  readonly organizationId?: string
  readonly body?: unknown
  readonly responseBytes?: number
  readonly requestBytes?: number
  readonly invitationOperationId?: string
  readonly timeoutMs?: 10000 | 15000
}
export type ContextOperation<T> = ContextOperationBase & ({
  readonly bodyMode?: 'json'
  readonly schema: ZodType<T>
  readonly successStatus?: number
} | {
  readonly bodyMode: 'empty'
  readonly schema: ZodType<T>
  readonly acknowledgment: T
  readonly successStatus: 204
})

export interface ContextExecutorDeps extends EnsureFreshSessionDeps {
  readSessionId: () => Promise<string | undefined>
  apiBase: string
  fetch?: typeof fetch
}

export interface ContextExecutorInput {
  expectedSession: string | undefined
  headers: Headers
  signal?: AbortSignal
}

export async function executeContextOperation<T>(
  operation: ContextOperation<T>,
  input: ContextExecutorInput,
  deps: ContextExecutorDeps
): Promise<{ binding: string; data: T }> {
  if (
    operation.requestBytes &&
    operation.body !== undefined &&
    serializedJsonBytes(operation.body) > operation.requestBytes
  )
    throw new ContextRequestError(413, 'PAYLOAD_TOO_LARGE')
  const url = operationUrl(operation, deps.apiBase)
  if (operation.invitationOperationId && !invitationOperationIdSchema.safeParse(operation.invitationOperationId).success)
    throw new ContextRequestError(400, 'BAD_REQUEST')
  validateExpectedContextSession(input.expectedSession)
  return withinContextDeadline(input.signal, async (signal) => {
    const captured = await captureContextSession(
      await deps.readSessionId(),
      deps,
      input.expectedSession
    )
    signal.throwIfAborted()
    const session = await freshContextSession(captured, deps)
    signal.throwIfAborted()
    const headers = forwardRequestHeaders(
      input.headers,
      session.accessToken,
      resolveTrustedClientIp(input.headers)
    )
    if (operation.organizationId) headers.set('x-amcore-organization-id', operation.organizationId)
    if (operation.body !== undefined) headers.set('content-type', 'application/json')
    if (operation.invitationOperationId) headers.set('x-invitation-operation-id', operation.invitationOperationId)
    const response = await (deps.fetch ?? fetch)(url, {
      method: operation.method,
      headers,
      cache: 'no-store',
      signal,
      ...(operation.body !== undefined && { body: JSON.stringify(operation.body) }),
    })
    let body: unknown
    if (operation.bodyMode === 'empty' && response.ok) {
      if (response.status !== 204 || response.body !== null)
        throw new ContextRequestError(502, 'INVALID_UPSTREAM_RESPONSE')
      body = operation.acknowledgment
    } else try {
      body = operation.responseBytes
        ? await readContextJson(response.body, operation.responseBytes)
        : await response.json()
    } catch {
      throw new ContextRequestError(502, 'INVALID_UPSTREAM_RESPONSE')
    }
    signal.throwIfAborted()
    if (!response.ok) {
      const code =
        body &&
        typeof body === 'object' &&
        'errorCode' in body &&
        typeof body.errorCode === 'string'
          ? body.errorCode
          : `HTTP_${response.status}`
      throw new ContextRequestError(response.status, code, parseRetryAfterSeconds(response.headers))
    }
    if (operation.successStatus !== undefined && response.status !== operation.successStatus)
      throw new ContextRequestError(502, 'INVALID_UPSTREAM_RESPONSE')
    const parsed = operation.schema.safeParse(body)
    if (!parsed.success) throw new ContextRequestError(502, 'INVALID_UPSTREAM_RESPONSE')
    const envelope = { binding: captured.binding, data: parsed.data }
    if (operation.responseBytes && serializedJsonBytes(envelope) > operation.responseBytes)
      throw new ContextRequestError(502, 'INVALID_UPSTREAM_RESPONSE')
    return envelope
  }, operation.timeoutMs ?? 5000)
}

function operationUrl<T>(operation: ContextOperation<T>, apiBase: string): string {
  const pathname = operation.path.split('?')[0]!
  if (
    !pathname.startsWith('/api/v1/') ||
    operation.path.includes('#') ||
    /[\\]|%(?:2f|5c|25)/i.test(pathname) ||
    pathname.split('/').some((part) => /^(?:\.|%2e){1,2}$/i.test(part))
  ) {
    throw new ContextRequestError(400, 'BAD_REQUEST')
  }
  if (
    operation.organizationId !== undefined &&
    !isOrganizationContextId(operation.organizationId)
  ) {
    throw new ContextRequestError(400, 'BAD_REQUEST')
  }
  const url = new URL(apiBase.replace(/\/$/, '') + operation.path)
  if (url.origin !== new URL(apiBase).origin) throw new ContextRequestError(400, 'BAD_REQUEST')
  return url.toString()
}
