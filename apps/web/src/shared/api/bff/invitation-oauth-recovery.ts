import { createHash } from 'node:crypto'

import { invitationOwnerStore } from './invitation-owner-store'
import { invitationRequestAuthority } from './invitation-request-authority'
import {
  assertInvitationReadCurrent,
  captureInvitationRequest,
} from './invitation-request-snapshot'
import { productContextDeps } from './product-context-deps'
import type { ProductWebContext } from './product-web-context.server'

import 'server-only'

/** A replay can recover navigation only with the already-published current app cookie. */
export async function recoverPublishedInvitedOAuth(
  request: Request,
  ticket: string,
  context?: ProductWebContext
) {
  const cookie = request.headers.get('cookie') ?? ''
  if (
    !cookie
      .split(';')
      .some((part) =>
        /^(?:__Host-amcore_(?:admin_)?invite_browser|amcore_(?:admin_)?invite_browser_local)=/.test(
          part.trim()
        )
      )
  )
    return null
  const authority = invitationRequestAuthority(request, false, context)
  if (!authority.ownerHash) return null
  const owner = await invitationOwnerStore.get(
    authority.ownerHash,
    authority.policy.origin,
    context
  )
  const hash = createHash('sha256').update(ticket).digest('hex')
  const matches = owner?.flows.filter((flow) => flow.handoff?.ticketHash === hash) ?? []
  if (matches.length !== 1) return null
  const snapshot = await captureInvitationRequest(
    request,
    matches[0]!.binding.flowId,
    productContextDeps(
      request.headers,
      context?.frontend === 'admin' ? 'admin-invite' : 'legacy-invite'
    )
  )
  const flow = snapshot.flow
  if (
    !snapshot.session ||
    flow.handoff?.newSessionId !== snapshot.session.sessionId ||
    flow.handoff.ticketHash !== hash ||
    (flow.state !== 'completing_signin' && flow.state !== 'active')
  )
    return null
  await assertInvitationReadCurrent(snapshot)
  return { flowId: flow.binding.flowId, locale: flow.locale }
}
