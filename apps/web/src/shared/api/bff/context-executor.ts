import { isOrganizationContextId } from '@amcore/shared'
import type { ZodType } from 'zod'

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
export interface ContextOperation<T> {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  readonly path: string
  readonly schema: ZodType<T>
  readonly organizationId?: string
  readonly body?: unknown
}

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
  const url = operationUrl(operation, deps.apiBase)
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
    const response = await (deps.fetch ?? fetch)(url, {
      method: operation.method,
      headers,
      cache: 'no-store',
      signal,
      ...(operation.body !== undefined && { body: JSON.stringify(operation.body) }),
    })
    const body: unknown = await response.json()
    signal.throwIfAborted()
    if (!response.ok) {
      const code =
        body &&
        typeof body === 'object' &&
        'errorCode' in body &&
        typeof body.errorCode === 'string'
          ? body.errorCode
          : `HTTP_${response.status}`
      throw new ContextRequestError(response.status, code)
    }
    const parsed = operation.schema.safeParse(body)
    if (!parsed.success) throw new ContextRequestError(502, 'INVALID_UPSTREAM_RESPONSE')
    return { binding: captured.binding, data: parsed.data }
  })
}

function operationUrl<T>(operation: ContextOperation<T>, apiBase: string): string {
  if (
    !operation.path.startsWith('/api/v1/') ||
    operation.path.includes('#') ||
    /[\\]|%(?:2f|5c|25)/i.test(operation.path)
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
