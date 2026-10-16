import {
  createOrganization,
  readOrganizationCreationPolicy,
  readOrganizationCreationResult,
} from '@/entities/organization-context/index.server'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { contextRoute } from '@/shared/api/bff/context-route'
import { contextRouteBody, contextRouteInput } from '@/shared/api/bff/context-route-input'

import 'server-only'

function readInput(request: Request) {
  if (new URL(request.url).search || request.body || request.headers.has('content-encoding'))
    throw new ContextRequestError(400, 'BAD_REQUEST')
  return contextRouteInput(request)
}

export const organizationCreationHandlers = {
  create: (request: Request) =>
    contextRoute(
      request,
      async () =>
        createOrganization(await contextRouteBody(request, 4096, true), contextRouteInput(request)),
      201
    ),
  policy: (request: Request) =>
    contextRoute(request, () => readOrganizationCreationPolicy(readInput(request))),
  result: (request: Request, operationId: string) =>
    contextRoute(request, () => readOrganizationCreationResult(operationId, readInput(request))),
}
