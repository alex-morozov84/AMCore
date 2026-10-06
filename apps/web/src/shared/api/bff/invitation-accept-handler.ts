import { acceptInviteResponseSchema, invitationFlowAcceptResponseSchema, invitationFlowAcceptSchema } from '@amcore/shared'

import { readContextJson } from './context-body-budget'
import { withinContextDeadline } from './context-deadline'
import { ContextRequestError } from './context-errors'
import type { ContextExecutorDeps } from './context-executor'
import { freshContextSession } from './context-session'
import { expectedInvitationFlow, invitationFlowChanged } from './invitation-flow-authority'
import { withInvitationOwnerLease } from './invitation-owner-lease'
import { assertInvitationReadCurrent, captureInvitationRequest } from './invitation-request-snapshot'
import { invitationRoute } from './invitation-route'
import { invitationBackend } from './invitation-upstream'

import 'server-only'

/** Explicit consent command. The browser persists its stable intent before sending this request. */
export function invitationAcceptHandler(request: Request, flowId: string, deps: ContextExecutorDeps) {
  return invitationRoute(request, () => withinContextDeadline(request.signal, async signal => {
    if (new URL(request.url).search) throw new ContextRequestError(400, 'BAD_REQUEST')
    const first = await captureInvitationRequest(request, flowId, deps, true)
    const input = invitationFlowAcceptSchema.parse(await readContextJson(request.body, 2048))
    if (input.binding.flowId !== flowId) throw invitationFlowChanged()
    return withInvitationOwnerLease(first.ownerHash, signal, async () => {
      const snapshot = await captureInvitationRequest(request, flowId, deps, true)
      if (!snapshot.session) throw new ContextRequestError(401, 'UNAUTHORIZED')
      const flow = expectedInvitationFlow(snapshot.owner, input.binding, snapshot.session.binding, Date.now())
      if (flow.state !== 'active' || (flow.handoff && !flow.handoff.confirmed) ||
        flow.intent.expectedInviteId !== input.expectedInviteId || flow.intent.expectedGeneration !== input.expectedGeneration)
        throw invitationFlowChanged()
      const session = await freshContextSession(snapshot.session, deps)
      signal.throwIfAborted()
      await assertInvitationReadCurrent(snapshot)
      const result = await invitationBackend('/auth/invites/accept', acceptInviteResponseSchema, {
        source: request.headers, signal, method: 'POST', expectedStatus: 200, credential: flow.credential,
        accessToken: session.accessToken, operationId: input.operationId,
        body: { continuation: true, expectedInviteId: input.expectedInviteId, expectedGeneration: input.expectedGeneration },
      })
      // A retired browser must recover its actor-bound receipt, rather than consume an old UI projection.
      await assertInvitationReadCurrent(snapshot)
      signal.throwIfAborted()
      return invitationFlowAcceptResponseSchema.parse({ binding: flow.binding, data: result.data })
    })
  }, 15000))
}
