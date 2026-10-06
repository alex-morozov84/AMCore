import { invitationOperationIdSchema } from '@amcore/shared'

import {
  createOrganizationInvitation,
  readInvitationManagerOperation,
  readInvitationRoleChoices,
  readOrganizationInvitations,
  reissueOrganizationInvitation,
  revokeOrganizationInvitation,
} from '@/entities/organization-context/index.server'
import { assertContextEmptyBody } from '@/shared/api/bff/context-body-budget'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import {
  assertContextMutationOrigin,
  contextRouteBody,
  contextRouteInput,
  contextRouteQuery,
} from '@/shared/api/bff/context-route-input'
import { invitationRoute } from '@/shared/api/bff/invitation-route'

import 'server-only'

function operationId(request: Request) {
  const parsed = invitationOperationIdSchema.safeParse(
    request.headers.get('x-invitation-operation-id')
  )
  if (!parsed.success) throw new ContextRequestError(400, 'BAD_REQUEST')
  return parsed.data
}
function readQuery(request: Request) {
  if (request.body || request.headers.has('content-encoding'))
    throw new ContextRequestError(400, 'BAD_REQUEST')
  return contextRouteQuery(request, 2048)
}
function noQuery(request: Request) {
  if (Object.keys(readQuery(request)).length) throw new ContextRequestError(400, 'BAD_REQUEST')
}

/** Application-owned invitation actions. Routes never select an arbitrary upstream operation. */
export const invitationManagerHandlers = {
  list: (request: Request, id: string) =>
    invitationRoute(request, () =>
      readOrganizationInvitations(id, readQuery(request), contextRouteInput(request))
    ),
  roles: (request: Request, id: string) =>
    invitationRoute(request, () =>
      readInvitationRoleChoices(id, readQuery(request), contextRouteInput(request))
    ),
  create: (request: Request, id: string) =>
    invitationRoute(
      request,
      async () =>
        createOrganizationInvitation(
          id,
          await contextRouteBody(request, 16384, true),
          operationId(request),
          contextRouteInput(request)
        ),
      202
    ),
  reissue: (request: Request, id: string, inviteId: string) =>
    invitationRoute(
      request,
      async () =>
        reissueOrganizationInvitation(
          id,
          inviteId,
          await contextRouteBody(request, 16384, true),
          operationId(request),
          contextRouteInput(request)
        ),
      202
    ),
  revoke: (request: Request, id: string, inviteId: string) =>
    invitationRoute(request, async () => {
      assertContextMutationOrigin(request, true)
      if (request.headers.has('content-encoding')) throw new ContextRequestError(400, 'BAD_REQUEST')
      await assertContextEmptyBody(request.body)
      return revokeOrganizationInvitation(
        id,
        inviteId,
        contextRouteQuery(request, 2048),
        operationId(request),
        contextRouteInput(request)
      )
    }),
  receipt: (request: Request, id: string, opId: string) =>
    invitationRoute(request, () => {
      noQuery(request)
      return readInvitationManagerOperation(id, opId, contextRouteInput(request))
    }),
}
export function invitationManagerMethodDenied(allow: string) {
  return () =>
    new Response(null, {
      status: 405,
      headers: {
        Allow: allow,
        'cache-control': 'private, no-store',
        'referrer-policy': 'no-referrer',
        'x-robots-tag': 'noindex, nofollow',
      },
    })
}
