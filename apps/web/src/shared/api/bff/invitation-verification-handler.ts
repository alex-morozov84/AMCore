import {
  invitationFlowExpectedSchema,
  invitationFlowVerificationResponseSchema,
  invitationInspectResponseSchema,
  userResponseSchema,
} from '@amcore/shared'
import { z } from 'zod'

import { readContextJson } from './context-body-budget'
import { withinContextDeadline } from './context-deadline'
import { ContextRequestError } from './context-errors'
import type { ContextExecutorDeps } from './context-executor'
import { freshContextSession } from './context-session'
import { expectedInvitationFlow, invitationFlowChanged } from './invitation-flow-authority'
import { withInvitationOwnerLease } from './invitation-owner-lease'
import {
  assertInvitationReadCurrent,
  captureInvitationRequest,
} from './invitation-request-snapshot'
import { invitationRoute } from './invitation-route'
import { invitationBackend } from './invitation-upstream'

import 'server-only'

/** Fresh actor and invitation observation shared by refresh and explicit verification return. */
export async function observeInvitationVerification(
  request: Request,
  snapshot: Awaited<ReturnType<typeof captureInvitationRequest>>,
  deps: ContextExecutorDeps,
  signal: AbortSignal
) {
  if (!snapshot.session) throw new ContextRequestError(401, 'UNAUTHORIZED')
  const session = await freshContextSession(snapshot.session, deps)
  const profile = await invitationBackend(
    '/auth/me',
    z.strictObject({ user: userResponseSchema.nullable() }),
    {
      source: request.headers,
      signal,
      method: 'GET',
      expectedStatus: 200,
      accessToken: session.accessToken,
    }
  )
  if (!profile.data.user || profile.data.user.id !== session.userSnapshot.id)
    throw invitationFlowChanged()
  const inspection = await invitationBackend(
    '/auth/invites/continuations/inspect',
    invitationInspectResponseSchema,
    {
      source: request.headers,
      signal,
      method: 'POST',
      expectedStatus: 200,
      accessToken: session.accessToken,
      credential: snapshot.flow.credential,
    }
  )
  await assertInvitationReadCurrent(snapshot)
  signal.throwIfAborted()
  return { user: profile.data.user, inspection: inspection.data }
}

/** Verification performed elsewhere is observed; this action never verifies an email or joins. */
export function invitationVerificationHandler(
  request: Request,
  flowId: string,
  deps: ContextExecutorDeps
) {
  return invitationRoute(request, () =>
    withinContextDeadline(
      request.signal,
      async (signal) => {
        if (new URL(request.url).search) throw new ContextRequestError(400, 'BAD_REQUEST')
        const first = await captureInvitationRequest(request, flowId, deps, true)
        const input = invitationFlowExpectedSchema.parse(await readContextJson(request.body, 2048))
        if (input.binding.flowId !== flowId) throw invitationFlowChanged()
        return withInvitationOwnerLease(first.ownerHash, signal, async () => {
          const snapshot = await captureInvitationRequest(request, flowId, deps, true)
          if (!snapshot.session) throw new ContextRequestError(401, 'UNAUTHORIZED')
          const flow = expectedInvitationFlow(
            snapshot.owner,
            input.binding,
            snapshot.session.binding,
            Date.now()
          )
          if (flow.state !== 'active' || (flow.handoff && !flow.handoff.confirmed))
            throw invitationFlowChanged()
          const data = await observeInvitationVerification(request, snapshot, deps, signal)
          return invitationFlowVerificationResponseSchema.parse({ binding: flow.binding, data })
        })
      },
      10000
    )
  )
}
