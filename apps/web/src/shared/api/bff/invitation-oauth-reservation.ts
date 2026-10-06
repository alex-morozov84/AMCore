import { invitationFlowExpectedSchema, invitationFlowOAuthResponseSchema, invitationOAuthCorrelationSchema } from '@amcore/shared'

import { readContextJson } from './context-body-budget'
import { withinContextDeadline } from './context-deadline'
import { ContextRequestError } from './context-errors'
import type { ContextExecutorDeps } from './context-executor'
import { reserveInvitationAuth } from './invitation-auth-transition'
import { invitationFlowChanged } from './invitation-flow-authority'
import type { InvitationOAuthCarrier } from './invitation-oauth-carrier'
import { reserveInvitationOAuthCarrier } from './invitation-oauth-store'
import { withInvitationOwnerLease } from './invitation-owner-lease'
import { captureInvitationRequest } from './invitation-request-snapshot'
import { invitationRoute } from './invitation-route'

import 'server-only'

/** Provider navigation is preceded by a bound, atomic owner+attempt reservation. */
export function invitationOAuthReservation(request: Request, flowId: string, provider: string, deps: ContextExecutorDeps) {
  return invitationRoute(request, () => withinContextDeadline(request.signal, async signal => {
    if (new URL(request.url).search) throw new ContextRequestError(400, 'BAD_REQUEST')
    const allowed = invitationOAuthCorrelationSchema.shape.provider.parse(provider)
    const first = await captureInvitationRequest(request, flowId, deps, true)
    const input = invitationFlowExpectedSchema.parse(await readContextJson(request.body, 2048))
    if (input.binding.flowId !== flowId) throw invitationFlowChanged()
    return withInvitationOwnerLease(first.ownerHash, signal, async () => {
      const snapshot = await captureInvitationRequest(request, flowId, deps, true)
      const reserved = reserveInvitationAuth(snapshot.owner, input.binding, snapshot.session?.binding ?? null, 'oauth', allowed, Date.now())
      const carrier: InvitationOAuthCarrier = { attemptId: reserved.attempt.id, ownerHash: snapshot.ownerHash,
        origin: snapshot.owner.origin, flowId, reservedRevision: reserved.flow.binding.flowRevision,
        expectedSessionBinding: null, ownerEpoch: snapshot.owner.epoch, provider: allowed, ...snapshot.flow.intent,
        fence: reserved.attempt.fence, createdAt: reserved.attempt.createdAt, expiresAt: reserved.attempt.expiresAt,
        status: 'reserved', ticketHash: null, backendSessionId: null }
      signal.throwIfAborted()
      if (!await reserveInvitationOAuthCarrier(snapshot.ownerHash, snapshot.owner.version, reserved.owner, carrier)) throw invitationFlowChanged()
      signal.throwIfAborted()
      return invitationFlowOAuthResponseSchema.parse({ binding: reserved.flow.binding,
        authorizeHref: `/api/auth/oauth/${allowed}?invitationAttempt=${reserved.attempt.id}` })
    })
  }, 15000))
}
