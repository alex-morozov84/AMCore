import { invitationFlowExpectedSchema, invitationVerificationReturnInputSchema, invitationVerificationReturnLinkSchema,
  invitationVerificationReturnResponseSchema, localizedFrontendUrl, type SupportedLocale } from '@amcore/shared'

import { readContextJson } from './context-body-budget'
import { withinContextDeadline } from './context-deadline'
import { ContextRequestError } from './context-errors'
import type { ContextExecutorDeps } from './context-executor'
import { expectedInvitationFlow, invitationFlowChanged } from './invitation-flow-authority'
import { withInvitationOwnerLease } from './invitation-owner-lease'
import { invitationRequestAuthority } from './invitation-request-authority'
import { assertInvitationReadCurrent, captureInvitationRequest } from './invitation-request-snapshot'
import { invitationRoute } from './invitation-route'
import { observeInvitationVerification } from './invitation-verification-handler'
import { consumeInvitationVerificationSelector, createInvitationVerificationSelector, readInvitationVerificationSelector } from './invitation-verification-store'

import 'server-only'

function pathname(origin: string, locale: string, path: string) {
  const url = new URL(localizedFrontendUrl(origin, locale as SupportedLocale, path))
  return url.pathname + url.search
}

export function invitationVerificationReturnLink(request: Request, flowId: string, deps: ContextExecutorDeps) {
  return invitationRoute(request, () => withinContextDeadline(request.signal, async signal => {
    if (new URL(request.url).search) throw new ContextRequestError(400, 'BAD_REQUEST')
    const first = await captureInvitationRequest(request, flowId, deps, true)
    const input = invitationFlowExpectedSchema.parse(await readContextJson(request.body, 2048))
    if (input.binding.flowId !== flowId) throw invitationFlowChanged()
    return withInvitationOwnerLease(first.ownerHash, signal, async () => {
      const snapshot = await captureInvitationRequest(request, flowId, deps, true)
      if (!snapshot.session) throw new ContextRequestError(401, 'UNAUTHORIZED')
      const flow = expectedInvitationFlow(snapshot.owner, input.binding, snapshot.session.binding, Date.now())
      if (flow.state !== 'active' || (flow.handoff && !flow.handoff.confirmed)) throw invitationFlowChanged()
      await observeInvitationVerification(request, snapshot, deps, signal)
      const id = await createInvitationVerificationSelector({ ownerHash: snapshot.ownerHash, origin: snapshot.owner.origin,
        binding: flow.binding, ownerEpoch: snapshot.owner.epoch, expiresAt: Math.min(Date.now() + 1800000, flow.expiresAt, snapshot.owner.expiresAt) })
      await assertInvitationReadCurrent(snapshot)
      signal.throwIfAborted()
      return invitationVerificationReturnLinkSchema.parse({ verifyHref: pathname(snapshot.owner.origin, flow.locale, `verify-email?inviteReturn=${id}`) })
    })
  }, 10000))
}

export function invitationVerificationReturn(request: Request, selectorId: string, deps: ContextExecutorDeps) {
  return invitationRoute(request, () => withinContextDeadline(request.signal, async signal => {
    if (new URL(request.url).search) throw new ContextRequestError(400, 'BAD_REQUEST')
    const authority = invitationRequestAuthority(request, true)
    if (!authority.ownerHash) throw invitationFlowChanged()
    const input = invitationVerificationReturnInputSchema.parse(await readContextJson(request.body, 2048))
    return withInvitationOwnerLease(authority.ownerHash, signal, async () => {
      const record = await readInvitationVerificationSelector(selectorId, authority.ownerHash!, authority.policy.origin)
      if (!record || record.binding.sessionBinding !== input.expectedSessionBinding) throw invitationFlowChanged()
      const snapshot = await captureInvitationRequest(request, record.binding.flowId, deps, true)
      if (!snapshot.session || snapshot.session.binding !== input.expectedSessionBinding) throw invitationFlowChanged()
      expectedInvitationFlow(snapshot.owner, record.binding, snapshot.session.binding, Date.now())
      if (!await consumeInvitationVerificationSelector(selectorId, snapshot.ownerHash, snapshot.owner.version, record)) throw invitationFlowChanged()
      const data = await observeInvitationVerification(request, snapshot, deps, signal)
      if (!data.user.emailVerified || data.inspection.state === 'verify_email') throw invitationFlowChanged()
      signal.throwIfAborted()
      return invitationVerificationReturnResponseSchema.parse({ binding: snapshot.flow.binding,
        destination: pathname(snapshot.owner.origin, snapshot.flow.locale, `invite/flow/${snapshot.flow.binding.flowId}`) })
    })
  }, 10000))
}
