import {
  invitationFlowAuthResponseSchema,
  invitationFlowExpectedSchema,
  invitationFlowIdSchema,
  invitationHandoffConfirmedSchema,
  publicationAcknowledgedSchema,
} from '@amcore/shared'

import { postBrowserAuth } from './browser-auth-upstream'
import { readContextJson } from './context-body-budget'
import { withinContextDeadline } from './context-deadline'
import { ContextRequestError } from './context-errors'
import type { ContextExecutorDeps } from './context-executor'
import { contextSessionBinding } from './context-session'
import { confirmInvitationAuth } from './invitation-auth-transition'
import { expectedInvitationFlow, invitationFlowChanged } from './invitation-flow-authority'
import { withInvitationOwnerLease } from './invitation-owner-lease'
import { invitationOwnerStore } from './invitation-owner-store'
import { captureInvitationRequest } from './invitation-request-snapshot'
import { invitationRoute } from './invitation-route'
import { invitationBackend } from './invitation-upstream'

import 'server-only'

/** Only the browser carrying the published session may confirm its durable API handoff. */
export function invitationAckHandler(
  request: Request,
  flowId: string,
  attemptId: string,
  deps: ContextExecutorDeps
) {
  return invitationRoute(request, () =>
    withinContextDeadline(
      request.signal,
      async (signal) => {
        if (new URL(request.url).search) throw new ContextRequestError(400, 'BAD_REQUEST')
        const id = invitationFlowIdSchema.parse(attemptId)
        const expected = invitationFlowExpectedSchema.parse(
          await readContextJson(request.body, 16384)
        )
        if (expected.binding.flowId !== flowId) throw invitationFlowChanged()
        const first = await captureInvitationRequest(request, flowId, deps, true)
        return withInvitationOwnerLease(
          first.ownerHash,
          signal,
          async () => {
            const snapshot = await captureInvitationRequest(request, flowId, deps, true)
            if (!snapshot.session) throw invitationFlowChanged()
            const flow = expectedInvitationFlow(
              snapshot.owner,
              expected.binding,
              snapshot.session.binding,
              Date.now()
            )
            const handoff = flow.handoff
            if (
              !handoff ||
              handoff.attemptId !== id ||
              handoff.newSessionId !== snapshot.session.sessionId ||
              (flow.state !== 'completing_signin' &&
                !(flow.state === 'active' && handoff.confirmed))
            )
              throw invitationFlowChanged()
            signal.throwIfAborted()
            // Do not refresh a pending SID. The API verifies the issued JWT's exact SID/actor and deadline.
            if (handoff.publication) {
              const metadata = handoff.publication
              if (!deps.webContext || !metadata.browser) throw invitationFlowChanged()
              const confirmed = await postBrowserAuth(
                request,
                deps.webContext,
                { id: metadata.flowBinding, browser: metadata.browser },
                '/auth/browser-publications/invitation-confirm',
                {
                  purpose: metadata.purpose,
                  operationId: metadata.operationId,
                  vaultBinding: metadata.vaultBinding,
                  accessToken: snapshot.session.entry.accessToken,
                  receipt: metadata.receipt,
                  handoff: { attemptId: id, cleanupKey: handoff.cleanupKey },
                },
                metadata.continuation
              )
              if (
                confirmed.status !== 200 ||
                !publicationAcknowledgedSchema.safeParse(confirmed.body).success
              )
                throw new ContextRequestError(503, 'SERVICE_UNAVAILABLE')
            } else {
              await invitationBackend(
                `/auth/invites/auth-handoffs/${id}/confirm`,
                invitationHandoffConfirmedSchema,
                {
                  context: deps.webContext,
                  source: request.headers,
                  signal,
                  method: 'POST',
                  expectedStatus: 200,
                  accessToken: snapshot.session.entry.accessToken,
                  handoff: { attemptId: id, cleanupKey: handoff.cleanupKey },
                }
              )
              signal.throwIfAborted()
            }
            const latest = await invitationOwnerStore.get(
              snapshot.ownerHash,
              snapshot.owner.origin,
              deps.webContext
            )
            if (!latest || latest.epoch !== snapshot.owner.epoch) throw invitationFlowChanged()
            const next = confirmInvitationAuth(
              latest,
              expected.binding,
              snapshot.session.binding,
              id,
              Date.now()
            )
            if (
              next !== latest &&
              !(await invitationOwnerStore.compareAndSet(
                snapshot.ownerHash,
                latest.version,
                next,
                deps.webContext
              ))
            )
              throw invitationFlowChanged()
            signal.throwIfAborted()
            return invitationFlowAuthResponseSchema.parse({
              binding: expected.binding,
              data: {
                user: snapshot.session.entry.userSnapshot,
                contextSession: contextSessionBinding(
                  snapshot.session.sessionId,
                  snapshot.session.entry
                ),
              },
              handoff: { attemptId: id },
            })
          },
          undefined,
          deps.webContext
        )
      },
      15000
    )
  )
}
