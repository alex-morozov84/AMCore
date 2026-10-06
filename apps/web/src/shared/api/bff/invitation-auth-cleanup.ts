import { AuthErrorCode, invitationFlowIdSchema, invitationHandoffAbortedSchema } from '@amcore/shared'

import { rejectInvitationAuth } from './invitation-auth-transition'
import { invitationOwnerStore } from './invitation-owner-store'
import { invitationBackend,InvitationBackendError } from './invitation-upstream'

import 'server-only'

export type InvitationCleanupOutcome = 'aborted' | 'confirmed' | 'unresolved'

/** Cleanup has its own short deadline; a dropped browser request must not cancel revocation. */
export async function abortInvitationAuth(
  source: Headers, proof: { attemptId: string; cleanupKey: string }
): Promise<InvitationCleanupOutcome> {
  const attemptId = invitationFlowIdSchema.parse(proof.attemptId)
  try {
    await invitationBackend(`/auth/invites/auth-handoffs/${attemptId}/abort`, invitationHandoffAbortedSchema, {
      source, signal: AbortSignal.timeout(5000), method: 'POST', expectedStatus: 200, handoff: proof,
    })
    return 'aborted'
  } catch (error) {
    if (error instanceof InvitationBackendError && error.status === 409 &&
      error.errorCode === AuthErrorCode.AUTH_HANDOFF_CONFIRMED) return 'confirmed'
    // A rejection/transport error cannot prove this session was revoked. Durable API cleanup remains.
    return 'unresolved'
  }
}

/** Call only for a known auth rejection or acknowledged cleanup, never an uncertain issuance. */
export async function releaseRejectedInvitationAuth(input: {
  ownerHash: string; origin: string; flowId: string; attemptId: string; fence: string
}): Promise<boolean> {
  const owner = await invitationOwnerStore.get(input.ownerHash, input.origin)
  if (!owner) return false
  let next
  try {
    next = rejectInvitationAuth(owner, input.flowId, input.attemptId, input.fence)
  } catch {
    return false
  }
  return invitationOwnerStore.compareAndSet(input.ownerHash, owner.version, next)
}
