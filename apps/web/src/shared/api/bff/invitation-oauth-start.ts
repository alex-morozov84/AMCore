import { invitationFlowIdSchema, invitationOAuthCorrelationSchema } from '@amcore/shared'

import { withinContextDeadline } from './context-deadline'
import { invitationFlowChanged } from './invitation-flow-authority'
import { invitationOAuthFlow } from './invitation-oauth-carrier'
import { readInvitationOAuthCarrier, startInvitationOAuthCarrier } from './invitation-oauth-store'
import { withInvitationOwnerLease } from './invitation-owner-lease'
import { captureInvitationRequest } from './invitation-request-snapshot'
import { productContextDeps } from './product-context-deps'

import 'server-only'

/** Only a server-reserved carrier can attach continuation authority to provider initiation. */
export async function startInvitedOAuth(request: Request, provider: string, attemptId: string,
  send: (headers: Headers, signal: AbortSignal) => Promise<Response>) {
  const id = invitationFlowIdSchema.parse(attemptId)
  const allowed = invitationOAuthCorrelationSchema.shape.provider.parse(provider)
  const carrier = await readInvitationOAuthCarrier(id)
  if (!carrier || carrier.provider !== allowed) throw invitationFlowChanged()
  return withinContextDeadline(request.signal, signal => withInvitationOwnerLease(carrier.ownerHash, signal, async () => {
    const snapshot = await captureInvitationRequest(request, carrier.flowId, productContextDeps(request.headers))
    const flow = invitationOAuthFlow(snapshot.owner, carrier, snapshot.ownerHash, snapshot.session?.binding ?? null, Date.now())
    if (carrier.status !== 'reserved' || carrier.createdAt + 60000 <= Date.now() || !flow.attempt)
      throw invitationFlowChanged()
    const next = { ...snapshot.owner, flows: snapshot.owner.flows.map(candidate =>
      candidate.binding.flowId === carrier.flowId ? { ...candidate, attempt: { ...flow.attempt!, started: true } } : candidate) }
    signal.throwIfAborted()
    if (!await startInvitationOAuthCarrier(snapshot.ownerHash, snapshot.owner.version, next, carrier)) throw invitationFlowChanged()
    const headers = new Headers({
      'x-invitation-continuation': flow.credential,
      'x-invitation-attempt-id': carrier.attemptId,
      'x-invitation-auth-attempt-id': carrier.attemptId,
      'x-invitation-handoff-key': flow.attempt.cleanupKey,
    })
    signal.throwIfAborted()
    return send(headers, signal)
  }), 15000)
}
