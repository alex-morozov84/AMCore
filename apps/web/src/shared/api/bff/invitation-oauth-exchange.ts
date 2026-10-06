import { createHash } from 'node:crypto'

import { type OAuthExchangeResponse, type UserResponse } from '@amcore/shared'

import { withinContextDeadline } from './context-deadline'
import { recoverFailedInvitationAuth } from './invitation-auth-failure'
import { publishInvitedCredentials } from './invitation-auth-publication'
import { invitationFlowChanged } from './invitation-flow-authority'
import { invitationOAuthFlow } from './invitation-oauth-carrier'
import { readInvitationOAuthCarrier } from './invitation-oauth-store'
import { withInvitationOwnerLease } from './invitation-owner-lease'
import { captureInvitationRequest } from './invitation-request-snapshot'
import { productContextDeps } from './product-context-deps'

import 'server-only'

/** API ticket correlation is mandatory; never select a flow from the user's latest tab. */
export async function publishInvitedOAuth(
  request: Request,
  ticket: string,
  exchange: OAuthExchangeResponse,
  refreshToken: string,
  user: UserResponse
) {
  const correlation = exchange.invitation
  if (!correlation) throw invitationFlowChanged()
  const carrier = await readInvitationOAuthCarrier(correlation.attemptId)
  if (
    !carrier ||
    carrier.status !== 'started' ||
    carrier.provider !== correlation.provider ||
    carrier.expectedInviteId !== correlation.expectedInviteId ||
    carrier.expectedGeneration !== correlation.expectedGeneration
  )
    throw invitationFlowChanged()
  return withinContextDeadline(
    request.signal,
    (signal) =>
      withInvitationOwnerLease(carrier.ownerHash, signal, async () => {
        const deps = productContextDeps(request.headers)
        const snapshot = await captureInvitationRequest(request, carrier.flowId, deps)
        const flow = invitationOAuthFlow(
          snapshot.owner,
          carrier,
          snapshot.ownerHash,
          snapshot.session?.binding ?? null,
          Date.now()
        )
        if (!flow.attempt) throw invitationFlowChanged()
        try {
          const published = await publishInvitedCredentials({
            snapshot,
            attempt: flow.attempt,
            signal,
            credentials: { data: { accessToken: exchange.accessToken, user }, refreshToken },
            oauth: {
              carrier,
              ticketHash: createHash('sha256').update(ticket).digest('hex'),
              backendSessionId: correlation.backendSessionId,
            },
          })
          signal.throwIfAborted()
          return { ...published, flowId: carrier.flowId, locale: flow.locale }
        } catch (error) {
          await recoverFailedInvitationAuth({
            request,
            snapshot,
            attempt: flow.attempt,
            error,
            store: deps.store,
          }).catch(() => undefined)
          throw error
        }
      }),
    15000
  )
}
