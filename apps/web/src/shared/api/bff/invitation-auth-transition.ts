import { randomBytes } from 'node:crypto'

import { type InvitationFlowBinding, InviteErrorCode } from '@amcore/shared'

import { ContextRequestError } from './context-errors'
import {
  expectedInvitationFlow,
  invitationFlowChanged,
  retireInvitationFlows,
} from './invitation-flow-authority'
import type { InvitationOwnerRecord, InvitationVaultFlow } from './invitation-vault-record'

import 'server-only'

type Attempt = NonNullable<InvitationVaultFlow['attempt']>
function replaceFlow(
  owner: InvitationOwnerRecord,
  flow: InvitationVaultFlow
): InvitationOwnerRecord {
  return {
    ...owner,
    flows: owner.flows.map((candidate) =>
      candidate.binding.flowId === flow.binding.flowId ? flow : candidate
    ),
  }
}

export function reserveInvitationAuth(
  owner: InvitationOwnerRecord,
  binding: InvitationFlowBinding,
  incomingSession: string | null,
  kind: Attempt['kind'],
  provider: Attempt['provider'],
  now: number
): { owner: InvitationOwnerRecord; flow: InvitationVaultFlow; attempt: Attempt } {
  const current = expectedInvitationFlow(owner, binding, incomingSession, now)
  if (
    current.state !== 'active' ||
    (current.handoff && !current.handoff.confirmed) ||
    (kind === 'oauth' && owner.pendingOAuthAttemptId)
  )
    throw new ContextRequestError(409, InviteErrorCode.INVITE_FLOW_BUSY)
  if (
    (kind === 'switch') !== (incomingSession !== null) ||
    (kind === 'oauth') !== (provider !== null)
  )
    throw invitationFlowChanged()
  const attempt: Attempt = {
    id: randomBytes(16).toString('base64url'),
    fence: randomBytes(16).toString('base64url'),
    kind,
    provider,
    ownerEpoch: owner.epoch,
    reservedRevision: binding.flowRevision + 1,
    expectedSessionBinding: incomingSession,
    createdAt: now,
    expiresAt: now + (kind === 'oauth' ? 360000 : 60000),
    started: false,
    cleanupKey: randomBytes(32).toString('base64url'),
  }
  const flow: InvitationVaultFlow = {
    ...current,
    state: 'authenticating',
    attempt,
    binding: { ...binding, flowRevision: attempt.reservedRevision },
  }
  return {
    flow,
    attempt,
    owner: {
      ...replaceFlow(owner, flow),
      pendingOAuthAttemptId: kind === 'oauth' ? attempt.id : owner.pendingOAuthAttemptId,
    },
  }
}

function reservedFlow(
  owner: InvitationOwnerRecord,
  id: string,
  attemptId: string,
  fence: string
): InvitationVaultFlow {
  const flow = owner.flows.find((candidate) => candidate.binding.flowId === id)
  if (
    !flow ||
    flow.state !== 'authenticating' ||
    !flow.attempt ||
    flow.attempt.id !== attemptId ||
    flow.attempt.fence !== fence ||
    flow.attempt.ownerEpoch !== owner.epoch ||
    flow.attempt.reservedRevision !== flow.binding.flowRevision
  )
    throw invitationFlowChanged()
  return flow
}

/** Only a known rejection/acknowledged cleanup releases a reservation, never an uncertain auth retry. */
export function rejectInvitationAuth(
  owner: InvitationOwnerRecord,
  id: string,
  attemptId: string,
  fence: string
): InvitationOwnerRecord {
  const flow = reservedFlow(owner, id, attemptId, fence)
  return {
    ...replaceFlow(owner, {
      ...flow,
      state: 'active',
      attempt: null,
      binding: { ...flow.binding, flowRevision: flow.binding.flowRevision + 1 },
    }),
    pendingOAuthAttemptId:
      owner.pendingOAuthAttemptId === attemptId ? null : owner.pendingOAuthAttemptId,
  }
}

export function publishInvitationAuth(
  owner: InvitationOwnerRecord,
  id: string,
  attemptId: string,
  fence: string,
  incomingSession: string | null,
  session: { binding: string; vaultId: string; backendId: string; deadline: number },
  now: number
): InvitationOwnerRecord {
  const current = reservedFlow(owner, id, attemptId, fence)
  const attempt = current.attempt!
  if (
    attempt.kind === 'switch' ||
    attempt.expectedSessionBinding !== incomingSession ||
    owner.sessionBinding !== incomingSession ||
    attempt.expiresAt <= now ||
    current.expiresAt <= now ||
    owner.expiresAt <= now ||
    session.deadline <= now
  )
    throw invitationFlowChanged()
  const retired = retireInvitationFlows(owner, session.binding)
  return replaceFlow(retired, {
    ...current,
    state: 'completing_signin',
    attempt: null,
    binding: {
      ...current.binding,
      flowRevision: current.binding.flowRevision + 1,
      sessionBinding: session.binding,
    },
    handoff: {
      attemptId,
      cleanupKey: attempt.cleanupKey,
      newSessionId: session.vaultId,
      backendSessionId: session.backendId,
      deadline: session.deadline,
      confirmed: false,
    },
  })
}

/** API confirmation must succeed first. A GET or Redis-only write cannot authenticate the handoff. */
export function confirmInvitationAuth(
  owner: InvitationOwnerRecord,
  binding: InvitationFlowBinding,
  incomingSession: string,
  attemptId: string,
  now: number
): InvitationOwnerRecord {
  const flow = expectedInvitationFlow(owner, binding, incomingSession, now)
  if (!flow.handoff || flow.handoff.attemptId !== attemptId) throw invitationFlowChanged()
  if (flow.handoff.confirmed && flow.state === 'active') return owner
  if (flow.state !== 'completing_signin') throw invitationFlowChanged()
  return replaceFlow(owner, {
    ...flow,
    state: 'active',
    handoff: { ...flow.handoff, confirmed: true },
  })
}

/** The caller must first revoke only the captured old session successfully. */
export function publishInvitationSignout(
  owner: InvitationOwnerRecord,
  id: string,
  attemptId: string,
  fence: string,
  incomingSession: string,
  now: number
): InvitationOwnerRecord {
  const current = reservedFlow(owner, id, attemptId, fence)
  if (
    current.attempt!.kind !== 'switch' ||
    current.attempt!.expectedSessionBinding !== incomingSession ||
    owner.sessionBinding !== incomingSession ||
    current.attempt!.expiresAt <= now ||
    current.expiresAt <= now
  )
    throw invitationFlowChanged()
  return replaceFlow(retireInvitationFlows(owner, null), {
    ...current,
    state: 'active',
    attempt: null,
    handoff: null,
    binding: {
      ...current.binding,
      flowRevision: current.binding.flowRevision + 1,
      sessionBinding: null,
    },
  })
}
