import { invitationOperationIdSchema, invitationOperationResponseSchema } from '@amcore/shared'

import { withinContextDeadline } from './context-deadline'
import { ContextRequestError } from './context-errors'
import type { ContextExecutorDeps } from './context-executor'
import { freshContextSession } from './context-session'
import { invitationIncomingSession } from './invitation-request-snapshot'
import { invitationRoute } from './invitation-route'
import { invitationBackend } from './invitation-upstream'

import 'server-only'

/** Actor-scoped durable recovery survives expired/pruned credentials and browser flow storage. */
export function invitationOperationHandler(
  request: Request,
  operationId: string,
  deps: ContextExecutorDeps
) {
  return invitationRoute(request, () =>
    withinContextDeadline(
      request.signal,
      async (signal) => {
        if (new URL(request.url).search) throw new ContextRequestError(400, 'BAD_REQUEST')
        const id = invitationOperationIdSchema.parse(operationId)
        const captured = await invitationIncomingSession(deps)
        if (!captured) throw new ContextRequestError(401, 'UNAUTHORIZED')
        signal.throwIfAborted()
        const session = await freshContextSession(captured, deps)
        signal.throwIfAborted()
        const result = await invitationBackend(
          `/auth/invites/operations/${id}`,
          invitationOperationResponseSchema,
          {
            source: request.headers,
            signal,
            method: 'GET',
            expectedStatus: 200,
            accessToken: session.accessToken,
          }
        )
        signal.throwIfAborted()
        return result.data
      },
      10000
    )
  )
}
