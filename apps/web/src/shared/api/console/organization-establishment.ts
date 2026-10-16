import {
  isOrganizationContextId,
  organizationBootstrapResultSchema,
  organizationBootstrapSchema,
  organizationPrepareAccountSchema,
  organizationPreparedAccountSchema,
  organizationSetupAccountSchema,
  organizationSetupStatusSchema,
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

const root = '/api/v1/admin/organization-establishment'

export function handleEstablishmentSession(request: Request): Promise<Response> {
  return contextRoute(request, () =>
    withinContextDeadline(request.signal, async (signal) => {
      assertRead(request)
      const deps = establishmentConsoleDeps(request.headers)
      const session = await captureContextSession(await deps.readSessionId(), deps, undefined, true)
      await executeContextOperation(
        {
          method: 'GET',
          path: `${root}/status`,
          schema: organizationSetupStatusSchema,
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

function mutate(
  request: Request,
  path: string,
  inputSchema: ZodType,
  schema: ZodType
): Promise<Response> {
  return contextRoute(request, async () => {
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
    const parsed = inputSchema.safeParse(await readContextJson(request.body, 4096))
    if (!parsed.success) throw new ContextRequestError(400, 'BAD_REQUEST')
    return executeContextOperation(
      {
        method: 'POST',
        path: `${root}/${path}`,
        body: parsed.data,
        schema,
        successStatus: 200,
        requestBytes: 4096,
        responseBytes: 16384,
        timeoutMs: 15000,
      },
      contextRouteInput(request),
      establishmentConsoleDeps(request.headers)
    )
  })
}

export const establishmentConsoleHandlers = {
  status: (request: Request) => read(request, 'status', organizationSetupStatusSchema),
  account: (request: Request, id: string) => {
    if (!isOrganizationContextId(id))
      return contextRoute(request, async () => {
        throw new ContextRequestError(400, 'BAD_REQUEST')
      })
    return read(request, `accounts/${id}/status`, organizationSetupAccountSchema)
  },
  prepare: (request: Request) =>
    mutate(
      request,
      'accounts/prepare',
      organizationPrepareAccountSchema,
      organizationPreparedAccountSchema
    ),
  bootstrap: (request: Request) =>
    mutate(request, 'bootstrap', organizationBootstrapSchema, organizationBootstrapResultSchema),
}
