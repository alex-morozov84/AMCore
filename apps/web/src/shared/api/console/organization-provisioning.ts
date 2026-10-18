import {
  invitationOperationIdSchema,
  isOrganizationContextId,
  provisioningCancelSchema,
  provisioningCommandReceiptSchema,
  provisioningCreateSchema,
  provisioningLookupSchema,
  provisioningPolicySchema,
  provisioningProgressSchema,
  provisioningReceiptSchema,
  provisioningReissueSchema,
  provisioningReplaceSchema,
} from '@amcore/shared'
import type { ZodType } from 'zod'

import { readContextJson } from '@/shared/api/bff/context-body-budget'
import { withinContextDeadline } from '@/shared/api/bff/context-deadline'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { executeContextOperation } from '@/shared/api/bff/context-executor'
import { contextRoute } from '@/shared/api/bff/context-route'
import {
  assertContextMutationOrigin,
  contextRouteInput,
} from '@/shared/api/bff/context-route-input'
import { captureContextSession } from '@/shared/api/bff/context-session'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'
import { getConsoleOrigin } from '@/shared/lib/admin-console-config'

import { isConsoleRequestOriginTrusted } from './authenticated-proxy'
import { establishmentConsoleDeps } from './establishment-deps'

import 'server-only'

const root = '/api/v1/admin'
function assertRead(request: Request): void {
  if (new URL(request.url).search || request.body || request.headers.has('content-encoding'))
    throw new ContextRequestError(400, 'BAD_REQUEST')
}
function read(request: Request, path: string, schema: ZodType): Promise<Response> {
  return contextRoute(request, () => {
    assertRead(request)
    return executeContextOperation(
      { method: 'GET', path: `${root}/${path}`, schema, successStatus: 200, responseBytes: 16384 },
      contextRouteInput(request),
      establishmentConsoleDeps(request.headers)
    )
  })
}
function write(
  request: Request,
  path: string,
  input: ZodType,
  schema: ZodType,
  successStatus: 200 | 201 = 200,
  errorDetails?: { code: string; schema: ZodType<Record<string, unknown>> }
): Promise<Response> {
  return contextRoute(
    request,
    async () => {
      if (!isConsoleRequestOriginTrusted(request) || !request.headers.get('origin'))
        throw new ContextRequestError(403, 'AUTH_ORIGIN_REJECTED')
      if (ADMIN_CONSOLE_CONFIG.mode !== 'host') assertContextMutationOrigin(request, true)
      else if (request.headers.get('origin') !== getConsoleOrigin())
        throw new ContextRequestError(403, 'AUTH_ORIGIN_REJECTED')
      if (
        new URL(request.url).search ||
        request.headers.has('content-encoding') ||
        !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')
      )
        throw new ContextRequestError(400, 'BAD_REQUEST')
      const body = input.safeParse(await readContextJson(request.body, 4096))
      if (!body.success) throw new ContextRequestError(400, 'BAD_REQUEST')
      return executeContextOperation(
        {
          method: 'POST',
          path: `${root}/${path}`,
          body: body.data,
          schema,
          successStatus,
          requestBytes: 4096,
          responseBytes: 16384,
          timeoutMs: 15000,
          errorDetails,
        },
        contextRouteInput(request),
        establishmentConsoleDeps(request.headers)
      )
    },
    successStatus
  )
}
export function provisioningSession(request: Request): Promise<Response> {
  return contextRoute(request, () =>
    withinContextDeadline(request.signal, async (signal) => {
      assertRead(request)
      const deps = establishmentConsoleDeps(request.headers)
      const session = await captureContextSession(await deps.readSessionId(), deps, undefined, true)
      await executeContextOperation(
        {
          method: 'GET',
          path: `${root}/organization-provisionings/policy`,
          schema: provisioningPolicySchema,
          responseBytes: 16384,
          successStatus: 200,
        },
        { headers: request.headers, signal, expectedSession: session.binding },
        deps
      )
      return {
        binding: session.binding,
        actor: { id: session.entry.userSnapshot.id, email: session.entry.userSnapshot.email },
      }
    })
  )
}
export function provisioningRoot(request: Request, parts: string[] = []): Promise<Response> {
  if (request.method === 'POST' && parts.length === 0)
    return write(
      request,
      'organization-provisionings',
      provisioningCreateSchema,
      provisioningReceiptSchema,
      201
    )
  if (request.method === 'GET' && parts.length === 1 && parts[0] === 'session')
    return provisioningSession(request)
  if (request.method === 'GET' && parts.length === 1 && parts[0] === 'policy')
    return read(request, 'organization-provisionings/policy', provisioningPolicySchema)
  if (
    request.method === 'GET' &&
    parts.length === 2 &&
    parts[0] === 'operations' &&
    invitationOperationIdSchema.safeParse(parts[1]).success
  )
    return read(
      request,
      `organization-provisionings/operations/${parts[1]}`,
      provisioningLookupSchema
    )
  return invalidRoute(request)
}
export function provisioningOrganization(
  request: Request,
  orgId: string,
  parts: string[] = []
): Promise<Response> {
  if (!isOrganizationContextId(orgId)) return invalidRoute(request)
  const path = `organizations/${encodeURIComponent(orgId)}/provisioning`
  if (request.method === 'GET' && parts.length === 0)
    return read(request, path, provisioningProgressSchema)
  if (request.method === 'POST' && parts.length === 1) {
    const action = parts[0]
    const schema =
      action === 'reissue'
        ? provisioningReissueSchema
        : action === 'replace-recipient'
          ? provisioningReplaceSchema
          : action === 'cancel'
            ? provisioningCancelSchema
            : undefined
    if (schema) return write(request, `${path}/${action}`, schema, provisioningCommandReceiptSchema)
  }
  return invalidRoute(request)
}
function invalidRoute(request: Request): Promise<Response> {
  return contextRoute(request, async () => {
    throw new ContextRequestError(400, 'BAD_REQUEST')
  })
}

// Same personal-session, origin, bounded JSON and deadline rules for platform organization commands.
export { write as writeConsoleOrganizationCommand }
