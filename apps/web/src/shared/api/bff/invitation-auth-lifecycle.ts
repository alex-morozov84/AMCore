import { createHash } from 'node:crypto'

import { PRODUCT_ADMIN_CONFIG } from '@amcore/shared'

import { createBrowserBindingVerifier } from './browser-binding.server'
import { withinContextDeadline } from './context-deadline'
import { invitationCookiePolicy, readInvitationOwner } from './invitation-cookie'
import { invitationFlowChanged, retireInvitationFlows } from './invitation-flow-authority'
import { withInvitationOwnerLease } from './invitation-owner-lease'
import { invitationOwnerHash, invitationOwnerStore } from './invitation-owner-store'
import { invitationRequestAuthority } from './invitation-request-authority'
import { type ProductWebContext, resolveProductWebContext } from './product-web-context.server'
import type { VaultRecord } from './session-vault.types'

import 'server-only'

type OwnerAuthority = {
  ownerHash: string
  policy: ReturnType<typeof invitationCookiePolicy>
  context: ProductWebContext | undefined
}

function authorities(request: Request, context?: ProductWebContext) {
  const contexts =
    context?.audience === 'product' && PRODUCT_ADMIN_CONFIG.mode === 'path'
      ? [
          resolveProductWebContext(request.headers, 'legacy-invite'),
          resolveProductWebContext(request.headers, 'admin-invite'),
        ]
      : [context]
  return contexts.flatMap<OwnerAuthority>((selected) => {
    if (!selected) {
      const cookie = request.headers.get('cookie') ?? ''
      if (!/(?:^|;\s*)(?:__Host-amcore_invite_browser|amcore_invite_browser_local)=/.test(cookie))
        return []
      const authority = invitationRequestAuthority(request, false)
      return authority.ownerHash
        ? [{ ...authority, ownerHash: authority.ownerHash, context: selected }]
        : []
    }
    const cookie = request.headers.get('cookie') ?? ''
    const names =
      selected.frontend === 'admin'
        ? ['__Host-amcore_admin_invite_browser', 'amcore_admin_invite_browser_local']
        : ['__Host-amcore_invite_browser', 'amcore_invite_browser_local']
    if (!cookie.split(';').some((part) => names.some((name) => part.trim().startsWith(`${name}=`))))
      return []
    const policy = invitationCookiePolicy(selected.origin, process.env, selected.frontend)
    const proof = readInvitationOwner(request.headers.get('cookie'), policy.name)
    return proof ? [{ policy, ownerHash: invitationOwnerHash(proof), context: selected }] : []
  })
}

function hasPending(owner: NonNullable<Awaited<ReturnType<typeof invitationOwnerStore.get>>>) {
  return (
    owner.pendingOAuthAttemptId ||
    owner.flows.some((flow) => flow.state === 'completing_signin' && !flow.handoff?.confirmed)
  )
}

async function ordinaryOwner(authority: OwnerAuthority) {
  const { ownerHash, policy, context } = authority
  await invitationOwnerStore.retireStaleForOrdinaryAuth(ownerHash, policy.origin, context)
  return invitationOwnerStore.get(ownerHash, policy.origin, context)
}

/** An uncorrelated OAuth result cannot bypass an unconfirmed invited handoff. */
export async function assertOrdinaryOAuthAllowed(request: Request, context?: ProductWebContext) {
  for (const authority of authorities(request, context)) {
    const owner = await ordinaryOwner(authority)
    if (owner && hasPending(owner)) throw invitationFlowChanged()
  }
}

/** Shared path sessions retire both journals; host sessions touch only their own surface. */
export async function retireFlowsForOrdinaryAuth(
  request: Request,
  session: { sessionId: string; actorId: string } | null,
  options?: {
    rejectPendingHandoff?: true
    verifyPublication?: () => Promise<void>
    onlyIfBindingChanged?: boolean
  },
  context?: ProductWebContext
) {
  for (const authority of authorities(request, context)) {
    const selected = authority.context
    const binding = session
      ? createHash('sha256')
          .update(
            JSON.stringify(
              selected?.frontend === 'admin'
                ? ['product-context-v2', selected.audience, session.sessionId, session.actorId]
                : ['product-context-v1', session.sessionId, session.actorId]
            )
          )
          .digest('hex')
      : null
    await withinContextDeadline(
      request.signal,
      (signal) =>
        withInvitationOwnerLease(
          authority.ownerHash,
          signal,
          async () => {
            // Recheck inside the owner lease: a delayed publication cannot retire a newer login's flows.
            await options?.verifyPublication?.()
            const owner = await ordinaryOwner(authority)
            if (!owner) return
            if (options?.onlyIfBindingChanged && owner.sessionBinding === binding) return
            if (options?.rejectPendingHandoff && hasPending(owner)) throw invitationFlowChanged()
            signal.throwIfAborted()
            if (
              !(await invitationOwnerStore.compareAndSet(
                authority.ownerHash,
                owner.version,
                retireInvitationFlows(owner, binding),
                selected
              ))
            )
              throw invitationFlowChanged()
          },
          undefined,
          selected
        ),
      10000
    )
  }
}

/** Normal provider initiation explicitly closes preceding invited OAuth reservations. */
export async function cancelInvitedOAuthForOrdinaryStart(
  request: Request,
  context?: ProductWebContext
) {
  for (const authority of authorities(request, context)) {
    await withinContextDeadline(
      request.signal,
      (signal) =>
        withInvitationOwnerLease(
          authority.ownerHash,
          signal,
          async () => {
            const owner = await ordinaryOwner(authority)
            if (!owner?.pendingOAuthAttemptId) return
            signal.throwIfAborted()
            if (
              !(await invitationOwnerStore.compareAndSet(
                authority.ownerHash,
                owner.version,
                retireInvitationFlows(owner, owner.sessionBinding),
                authority.context
              ))
            )
              throw invitationFlowChanged()
          },
          undefined,
          authority.context
        ),
      10000
    )
  }
}

/** Replaying the same publication preserves flows opened afterwards under that exact session. */
export async function retirePublishedInvitationFlows(
  request: Request,
  context: ProductWebContext,
  sessionId: string,
  entry: VaultRecord
): Promise<void> {
  const verify = createBrowserBindingVerifier(request.headers, context.audience)
  await retireFlowsForOrdinaryAuth(
    request,
    { sessionId, actorId: entry.userSnapshot.id },
    {
      onlyIfBindingChanged: true,
      verifyPublication: () => verify(entry),
    },
    context
  )
}
