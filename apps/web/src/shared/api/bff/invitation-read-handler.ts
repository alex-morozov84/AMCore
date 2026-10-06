import { invitationContextSchema, invitationFlowPendingResponseSchema, invitationInspectResponseSchema } from '@amcore/shared'

import { withinContextDeadline } from './context-deadline'
import { ContextRequestError } from './context-errors'
import type { ContextExecutorDeps } from './context-executor'
import { freshContextSession } from './context-session'
import { invitationFlowChanged } from './invitation-flow-authority'
import { assertInvitationReadCurrent, captureInvitationRequest } from './invitation-request-snapshot'
import { invitationRoute } from './invitation-route'
import { invitationBackend } from './invitation-upstream'

import 'server-only'

/** GET observes auth state; it never confirms a handoff, rebinds an actor or accepts membership. */
export function invitationReadHandler(request: Request, flowId: string, kind: 'context' | 'inspect', deps: ContextExecutorDeps) {
  return invitationRoute(request, () => withinContextDeadline(request.signal, async signal => {
    if (new URL(request.url).search) throw new ContextRequestError(400, 'BAD_REQUEST')
    const snapshot = await captureInvitationRequest(request, flowId, deps)
    signal.throwIfAborted()
    const { flow } = snapshot
    if (flow.state === 'authenticating')
      return invitationFlowPendingResponseSchema.parse({ state: flow.state, binding: flow.binding })
    if (flow.state === 'completing_signin') {
      if (!flow.handoff) throw invitationFlowChanged()
      return invitationFlowPendingResponseSchema.parse({ state: flow.state, binding: flow.binding,
        handoff: { attemptId: flow.handoff.attemptId } })
    }
    if (kind === 'inspect' && !snapshot.session) throw new ContextRequestError(401, 'UNAUTHORIZED')
    const session = snapshot.session ? await freshContextSession(snapshot.session, deps) : null
    signal.throwIfAborted()
    const result = kind === 'context'
      ? await invitationBackend('/auth/invites/continuations/context', invitationContextSchema, {
        source: request.headers, signal, method: 'POST', expectedStatus: 200, credential: flow.credential,
      })
      : await invitationBackend('/auth/invites/continuations/inspect', invitationInspectResponseSchema, {
        source: request.headers, signal, method: 'POST', expectedStatus: 200, credential: flow.credential,
        accessToken: session!.accessToken,
      })
    await assertInvitationReadCurrent(snapshot)
    signal.throwIfAborted()
    return { binding: flow.binding, data: result.data }
  }, 10000))
}
