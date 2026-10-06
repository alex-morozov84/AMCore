import { abortInvitationAuth, releaseRejectedInvitationAuth } from './invitation-auth-cleanup'
import { retireInvitationFlows } from './invitation-flow-authority'
import { invitationOwnerStore } from './invitation-owner-store'
import type { captureInvitationRequest } from './invitation-request-snapshot'
import { InvitationBackendError } from './invitation-upstream'
import type { InvitationVaultFlow } from './invitation-vault-record'
import type { VaultStore } from './session-vault.types'

import 'server-only'

/** Acknowledged API revocation is the prerequisite for undoing an uncertain publication. */
export async function recoverFailedInvitationAuth(input: {
  request: Request
  snapshot: Awaited<ReturnType<typeof captureInvitationRequest>>
  attempt: NonNullable<InvitationVaultFlow['attempt']>
  error: unknown
  store: VaultStore
}) {
  const { snapshot, attempt } = input
  const knownRejection = input.error instanceof InvitationBackendError && input.error.knownRejection
  const aborted = !knownRejection && await abortInvitationAuth(input.request.headers, {
    attemptId: attempt.id, cleanupKey: attempt.cleanupKey,
  }) === 'aborted'
  if (!knownRejection && !aborted) return
  const owner = await invitationOwnerStore.get(snapshot.ownerHash, snapshot.owner.origin)
  const flow = owner?.flows.find(candidate => candidate.binding.flowId === snapshot.flow.binding.flowId)
  if (aborted && owner && flow?.state === 'completing_signin' &&
    flow.handoff?.attemptId === attempt.id && !flow.handoff.confirmed) {
    // A transport failure can follow a committed Redis publication. Retire its exact journal;
    // deleting the revoked SID cannot remove a successor allocated by another login.
    if (await invitationOwnerStore.compareAndSet(snapshot.ownerHash, owner.version,
      retireInvitationFlows(owner, snapshot.session?.binding ?? null)))
      await input.store.delete(flow.handoff.newSessionId)
    return
  }
  await releaseRejectedInvitationAuth({ ownerHash: snapshot.ownerHash, origin: snapshot.owner.origin,
    flowId: snapshot.flow.binding.flowId, attemptId: attempt.id, fence: attempt.fence })
}
