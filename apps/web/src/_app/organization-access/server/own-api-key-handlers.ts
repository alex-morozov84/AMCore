import { OWN_KEY_QUERY_BYTES, OWN_KEY_REQUEST_BYTES } from '@amcore/shared'

import {
  createOwnApiKey,
  readOwnApiKeys,
  readOwnKeyOrganizations,
  revokeOwnApiKey,
  verifyOwnApiKeySession,
} from '@/entities/api-key/index.server'
import { assertContextEmptyBody } from '@/shared/api/bff/context-body-budget'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { contextRoute } from '@/shared/api/bff/context-route'
import {
  assertContextMutationOrigin,
  contextRouteBody,
  contextRouteInput,
  contextRouteQuery,
} from '@/shared/api/bff/context-route-input'

import 'server-only'

function noQuery(request: Request) {
  if (new URL(request.url).search) throw new ContextRequestError(400, 'BAD_REQUEST')
}
export const ownApiKeyHandlers = {
  organizations: (request: Request) =>
    contextRoute(request, () =>
      readOwnKeyOrganizations(
        contextRouteQuery(request, OWN_KEY_QUERY_BYTES),
        contextRouteInput(request)
      )
    ),
  list: (request: Request) =>
    contextRoute(request, () =>
      readOwnApiKeys(contextRouteQuery(request, OWN_KEY_QUERY_BYTES), contextRouteInput(request))
    ),
  create: (request: Request) =>
    contextRoute(
      request,
      async () =>
        createOwnApiKey(
          await contextRouteBody(request, OWN_KEY_REQUEST_BYTES, true),
          contextRouteInput(request)
        ),
      201
    ),
  revoke: (request: Request, id: string) =>
    contextRoute(request, async () => {
      assertContextMutationOrigin(request, true)
      noQuery(request)
      if (request.headers.has('content-encoding')) throw new ContextRequestError(400, 'BAD_REQUEST')
      await assertContextEmptyBody(request.body)
      return revokeOwnApiKey(id, contextRouteInput(request))
    }),
  session: (request: Request) =>
    contextRoute(request, async () => {
      noQuery(request)
      return verifyOwnApiKeySession(contextRouteInput(request))
    }),
}
export function ownApiKeyMethodDenied(allow: string) {
  return new Response(null, {
    status: 405,
    headers: { allow, 'cache-control': 'private, no-store' },
  })
}
