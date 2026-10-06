import type { AuthResponse } from '@amcore/shared'

import { contextSessionBinding } from './context-session'
import { publishInvitationAuth } from './invitation-auth-transition'
import { invitationFlowChanged } from './invitation-flow-authority'
import { invitationIssuedSessionId } from './invitation-issued-session'
import { type InvitationOAuthCarrier, invitationOAuthFlow } from './invitation-oauth-carrier'
import { invitationOwnerStore } from './invitation-owner-store'
import type { captureInvitationRequest } from './invitation-request-snapshot'
import { discardInvitationSession, publishInvitationSession, stageInvitationSession } from './invitation-session-publication'
import { InvitationBackendError } from './invitation-upstream'
import type { InvitationVaultFlow } from './invitation-vault-record'
import { ACCESS_TOKEN_LIFETIME_MS } from './vault-constants'

import 'server-only'

/** Returns a cookie ID to the server caller only after atomic vault/journal publication. */
export async function publishInvitedCredentials(input: {
  snapshot: Awaited<ReturnType<typeof captureInvitationRequest>>
  attempt: NonNullable<InvitationVaultFlow['attempt']>
  credentials: { data: AuthResponse; refreshToken: string | null }
  signal: AbortSignal
  oauth?: { carrier: InvitationOAuthCarrier; ticketHash: string; backendSessionId: string }
}) {
  const { snapshot, attempt, credentials, signal } = input
  signal.throwIfAborted()
  if (!credentials.refreshToken) throw new InvitationBackendError(503, false)
  const backendId = invitationIssuedSessionId(credentials.data.accessToken, credentials.data.user.id)
  if (input.oauth && input.oauth.backendSessionId !== backendId) throw invitationFlowChanged()
  const entry = { accessToken: credentials.data.accessToken, refreshToken: credentials.refreshToken,
    accessTokenExpiresAt: Date.now() + ACCESS_TOKEN_LIFETIME_MS, userSnapshot: credentials.data.user, version: 1 }
  // OAuth reservation outlives issuance; only the API confirms its durable issuance deadline.
  const deadline = Math.min(Date.now() + 60000, attempt.expiresAt, snapshot.flow.expiresAt)
  const sessionId = await stageInvitationSession({ ownerHash: snapshot.ownerHash,
    flowId: snapshot.flow.binding.flowId, attemptId: attempt.id, deadline, entry, oauth: input.oauth })
  try {
    signal.throwIfAborted()
    const owner = await invitationOwnerStore.get(snapshot.ownerHash, snapshot.owner.origin)
    if (!owner) throw invitationFlowChanged()
    if (input.oauth) invitationOAuthFlow(owner, input.oauth.carrier, snapshot.ownerHash, snapshot.session?.binding ?? null, Date.now())
    const next = publishInvitationAuth(owner, snapshot.flow.binding.flowId, attempt.id, attempt.fence,
      snapshot.session?.binding ?? null, { binding: contextSessionBinding(sessionId, entry),
        vaultId: sessionId, backendId, deadline }, Date.now())
    if (input.oauth) {
      const flow = next.flows.find(candidate => candidate.binding.flowId === snapshot.flow.binding.flowId)!
      flow.handoff = { ...flow.handoff!, ticketHash: input.oauth.ticketHash }
    }
    signal.throwIfAborted()
    if (!await publishInvitationSession(snapshot.ownerHash, owner.version, next, sessionId, input.oauth?.carrier.attemptId))
      throw invitationFlowChanged()
    // No await follows publication: the caller owns immediate cookie emission and safe projection.
    const flow = next.flows.find(candidate => candidate.binding.flowId === snapshot.flow.binding.flowId)!
    return { sessionId, binding: flow.binding, user: credentials.data.user, attemptId: attempt.id }
  } catch (error) {
    // This cannot delete credentials that the publication transaction already promoted.
    await discardInvitationSession(snapshot.ownerHash, sessionId).catch(() => undefined)
    throw error
  }
}
