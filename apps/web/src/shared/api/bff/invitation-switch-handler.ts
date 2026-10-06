import { NextResponse } from 'next/server'
import { invitationFlowExpectedSchema, invitationFlowSwitchResponseSchema } from '@amcore/shared'

import { readContextJson } from './context-body-budget'
import { withinContextDeadline } from './context-deadline'
import { ContextRequestError } from './context-errors'
import type { ContextExecutorDeps } from './context-executor'
import { publishInvitationSignout, reserveInvitationAuth } from './invitation-auth-transition'
import { rejectInvitationAuth } from './invitation-auth-transition'
import { invitationFlowChanged } from './invitation-flow-authority'
import { withInvitationOwnerLease } from './invitation-owner-lease'
import { invitationOwnerStore } from './invitation-owner-store'
import { captureInvitationRequest } from './invitation-request-snapshot'
import { invitationRoute } from './invitation-route'
import { invitationBackendNoContent } from './invitation-upstream'
import { SESSION_COOKIE_NAME, sessionCookieOptions } from './session-cookie'

import 'server-only'

/** Deliberate neutral transition; the ordinary best-effort logout contract is unsuitable here. */
export async function invitationSwitchHandler(request: Request, flowId: string, deps: ContextExecutorDeps) {
  const response = await invitationRoute(request, () => withinContextDeadline(request.signal, async signal => {
    if (new URL(request.url).search) throw new ContextRequestError(400, 'BAD_REQUEST')
    const first = await captureInvitationRequest(request, flowId, deps, true)
    const input = invitationFlowExpectedSchema.parse(await readContextJson(request.body, 2048))
    if (input.binding.flowId !== flowId) throw invitationFlowChanged()
    return withInvitationOwnerLease(first.ownerHash, signal, async () => {
      const snapshot = await captureInvitationRequest(request, flowId, deps, true)
      if (!snapshot.session) throw new ContextRequestError(401, 'UNAUTHORIZED')
      const lock = await deps.lock.acquire(snapshot.session.sessionId, 25000)
      if (!lock) throw new ContextRequestError(409, 'INVITE_FLOW_BUSY')
      try {
        // Recapture under the ordinary refresh lock so logout uses the last rotated token of this vault ID.
        const current = await captureInvitationRequest(request, flowId, deps, true)
        if (!current.session || current.session.sessionId !== snapshot.session.sessionId) throw invitationFlowChanged()
        const reserved = reserveInvitationAuth(current.owner, input.binding, current.session.binding, 'switch', null, Date.now())
        signal.throwIfAborted()
        if (!await invitationOwnerStore.compareAndSet(current.ownerHash, current.owner.version, reserved.owner)) throw invitationFlowChanged()
        try {
          await invitationBackendNoContent('/auth/logout', { source: request.headers, signal, method: 'POST',
            refreshToken: current.session.entry.refreshToken })
        } catch (error) {
          // Revocation can be unknown. Preserve the captured binding and require reopening/sign-in guidance.
          const latest = await invitationOwnerStore.get(current.ownerHash, current.owner.origin)
          if (latest) {
            const rejected = rejectInvitationAuth(latest, flowId, reserved.attempt.id, reserved.attempt.fence)
            await invitationOwnerStore.compareAndSet(current.ownerHash, latest.version, rejected)
          }
          throw error
        }
        signal.throwIfAborted()
        const latest = await invitationOwnerStore.get(current.ownerHash, current.owner.origin)
        if (!latest) throw invitationFlowChanged()
        const next = publishInvitationSignout(latest, flowId, reserved.attempt.id, reserved.attempt.fence, current.session.binding, Date.now())
        if (!await invitationOwnerStore.compareAndSet(current.ownerHash, latest.version, next)) throw invitationFlowChanged()
        await deps.store.delete(current.session.sessionId)
        signal.throwIfAborted()
        const chosen = next.flows.find(flow => flow.binding.flowId === flowId)!
        return invitationFlowSwitchResponseSchema.parse({ binding: chosen.binding, data: { status: 'signed_out' } })
      } finally { await deps.lock.release(snapshot.session.sessionId, lock).catch(() => undefined) }
    })
  }, 15000))
  if (!response.ok) return response
  const result = new NextResponse(response.body, { status: response.status, headers: response.headers })
  result.cookies.set(SESSION_COOKIE_NAME, '', { ...sessionCookieOptions(), maxAge: 0 })
  return result
}
