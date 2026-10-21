import { invitationFlowIdSchema } from '@amcore/shared'

import type { ContextExecutorDeps } from './context-executor'
import type { captureContextSession } from './context-session'
import { contextSessionBinding } from './context-session'
import { currentInvitationFlow, invitationFlowChanged } from './invitation-flow-authority'
import { invitationOwnerStore } from './invitation-owner-store'
import { invitationRequestAuthority } from './invitation-request-authority'
import type { VaultEntry } from './session-vault.types'

import 'server-only'

/** Snapshot the incoming session without refresh: pending handoffs must never mint child sessions. */
export async function invitationIncomingSession(
  deps: ContextExecutorDeps
): Promise<Awaited<ReturnType<typeof captureContextSession>> | null> {
  const sessionId = await deps.readSessionId()
  if (!sessionId) return null
  if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId)) throw invitationFlowChanged()
  const entry: VaultEntry | null = await deps.store.get(sessionId)
  if (!entry) throw invitationFlowChanged()
  const bindingVersion = deps.webContext?.frontend === 'admin' ? (2 as const) : (1 as const)
  return {
    sessionId,
    entry,
    bindingVersion,
    binding: contextSessionBinding(sessionId, entry, bindingVersion),
  }
}

export async function captureInvitationRequest(
  request: Request,
  flowId: string,
  deps: ContextExecutorDeps,
  mutation = false
) {
  const id = invitationFlowIdSchema.parse(flowId)
  const authority = invitationRequestAuthority(request, mutation, deps.webContext)
  if (!authority.ownerHash) throw invitationFlowChanged()
  const [owner, session] = await Promise.all([
    invitationOwnerStore.get(authority.ownerHash, authority.policy.origin, deps.webContext),
    invitationIncomingSession(deps),
  ])
  if (!owner) throw invitationFlowChanged()
  const flow = currentInvitationFlow(owner, id, session?.binding ?? null, Date.now())
  return {
    ...authority,
    ownerHash: authority.ownerHash,
    owner,
    flow,
    session,
    ...(deps.webContext ? { webContext: deps.webContext } : {}),
  }
}

export async function assertInvitationReadCurrent(
  snapshot: Awaited<ReturnType<typeof captureInvitationRequest>>
) {
  const latest = await invitationOwnerStore.get(
    snapshot.ownerHash,
    snapshot.owner.origin,
    snapshot.webContext
  )
  if (!latest || latest.epoch !== snapshot.owner.epoch) throw invitationFlowChanged()
  const flow = currentInvitationFlow(
    latest,
    snapshot.flow.binding.flowId,
    snapshot.session?.binding ?? null,
    Date.now()
  )
  if (
    flow.binding.flowRevision !== snapshot.flow.binding.flowRevision ||
    flow.state !== snapshot.flow.state
  )
    throw invitationFlowChanged()
}
