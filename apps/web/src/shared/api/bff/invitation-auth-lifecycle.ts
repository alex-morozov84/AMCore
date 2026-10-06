import { createHash } from 'node:crypto'

import { withinContextDeadline } from './context-deadline'
import { invitationFlowChanged, retireInvitationFlows } from './invitation-flow-authority'
import { withInvitationOwnerLease } from './invitation-owner-lease'
import { invitationOwnerStore } from './invitation-owner-store'
import { invitationRequestAuthority } from './invitation-request-authority'

import 'server-only'

/** Ordinary auth stays usable without invitation cookies or invitation configuration. */
function optionalAuthority(request: Request) {
  const cookie = request.headers.get('cookie') ?? ''
  if (
    !cookie
      .split(';')
      .some((part) =>
        /^(?:__Host-amcore_invite_browser|amcore_invite_browser_local)=/.test(part.trim())
      )
  )
    return null
  return invitationRequestAuthority(request, false)
}

/** An uncorrelated OAuth result cannot bypass a pending invited handoff. */
export async function assertOrdinaryOAuthAllowed(request: Request) {
  const authority = optionalAuthority(request)
  if (!authority?.ownerHash) return
  const owner = await invitationOwnerStore.get(authority.ownerHash, authority.policy.origin)
  if (
    owner?.pendingOAuthAttemptId ||
    owner?.flows.some((flow) => flow.state === 'completing_signin' && !flow.handoff?.confirmed)
  )
    throw invitationFlowChanged()
}

/** Publishing ordinary auth retires all prior flows before emitting the new browser session. */
export async function retireFlowsForOrdinaryAuth(
  request: Request,
  session: { sessionId: string; actorId: string } | null,
  options?: { rejectPendingHandoff: true }
) {
  const authority = optionalAuthority(request)
  if (!authority?.ownerHash) return
  const hash = authority.ownerHash
  const binding = session
    ? createHash('sha256')
        .update(JSON.stringify(['product-context-v1', session.sessionId, session.actorId]))
        .digest('hex')
    : null
  return withinContextDeadline(
    request.signal,
    (signal) =>
      withInvitationOwnerLease(hash, signal, async () => {
        const owner = await invitationOwnerStore.get(hash, authority.policy.origin)
        if (!owner) return
        if (
          options?.rejectPendingHandoff &&
          (owner.pendingOAuthAttemptId ||
            owner.flows.some(
              (flow) => flow.state === 'completing_signin' && !flow.handoff?.confirmed
            ))
        )
          throw invitationFlowChanged()
        signal.throwIfAborted()
        if (
          !(await invitationOwnerStore.compareAndSet(
            hash,
            owner.version,
            retireInvitationFlows(owner, binding)
          ))
        )
          throw invitationFlowChanged()
      }),
    10000
  )
}

/** Normal provider initiation explicitly closes the prior invited OAuth flow. */
export async function cancelInvitedOAuthForOrdinaryStart(request: Request) {
  const authority = optionalAuthority(request)
  if (!authority?.ownerHash) return
  const hash = authority.ownerHash
  return withinContextDeadline(
    request.signal,
    (signal) =>
      withInvitationOwnerLease(hash, signal, async () => {
        const owner = await invitationOwnerStore.get(hash, authority.policy.origin)
        if (!owner?.pendingOAuthAttemptId) return
        signal.throwIfAborted()
        if (
          !(await invitationOwnerStore.compareAndSet(
            hash,
            owner.version,
            retireInvitationFlows(owner, owner.sessionBinding)
          ))
        )
          throw invitationFlowChanged()
      }),
    10000
  )
}
