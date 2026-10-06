import { NextResponse } from 'next/server'
import {
  authResponseSchema,
  invitationFlowAuthResponseSchema,
  invitationFlowLoginSchema,
  invitationFlowRegisterSchema,
} from '@amcore/shared'

import { readContextJson } from './context-body-budget'
import { withinContextDeadline } from './context-deadline'
import { ContextRequestError } from './context-errors'
import type { ContextExecutorDeps } from './context-executor'
import { recoverFailedInvitationAuth } from './invitation-auth-failure'
import { publishInvitedCredentials } from './invitation-auth-publication'
import { reserveInvitationAuth } from './invitation-auth-transition'
import { invitationFlowChanged } from './invitation-flow-authority'
import { withInvitationOwnerLease } from './invitation-owner-lease'
import { invitationOwnerStore } from './invitation-owner-store'
import { captureInvitationRequest } from './invitation-request-snapshot'
import { invitationRoute } from './invitation-route'
import { invitationBackend } from './invitation-upstream'
import { SESSION_COOKIE_NAME, sessionCookieOptions } from './session-cookie'

import 'server-only'

export async function invitationCredentialHandler(
  request: Request,
  flowId: string,
  kind: 'login' | 'register',
  deps: ContextExecutorDeps
) {
  let publishedSessionId: string | undefined
  const response = await invitationRoute(
    request,
    () =>
      withinContextDeadline(
        request.signal,
        async (signal) => {
          if (new URL(request.url).search) throw new ContextRequestError(400, 'BAD_REQUEST')
          // Authenticate owner/origin before consuming credentials; recapture under the lease before effects.
          const first = await captureInvitationRequest(request, flowId, deps, true)
          const raw = await readContextJson(request.body, 16384)
          const input =
            kind === 'login'
              ? invitationFlowLoginSchema.parse(raw)
              : invitationFlowRegisterSchema.parse(raw)
          const { binding, ...body } = input
          if (binding.flowId !== flowId) throw invitationFlowChanged()
          return withInvitationOwnerLease(first.ownerHash, signal, async () => {
            const snapshot = await captureInvitationRequest(request, flowId, deps, true)
            const reserved = reserveInvitationAuth(
              snapshot.owner,
              binding,
              snapshot.session?.binding ?? null,
              kind,
              null,
              Date.now()
            )
            signal.throwIfAborted()
            if (
              !(await invitationOwnerStore.compareAndSet(
                snapshot.ownerHash,
                snapshot.owner.version,
                reserved.owner
              ))
            )
              throw invitationFlowChanged()
            try {
              signal.throwIfAborted()
              const credentials = await invitationBackend(
                kind === 'login' ? '/auth/login' : '/auth/invites/register',
                authResponseSchema,
                {
                  source: request.headers,
                  signal,
                  method: 'POST',
                  expectedStatus: kind === 'login' ? 200 : 201,
                  body,
                  credential: snapshot.flow.credential,
                  handoff: {
                    attemptId: reserved.attempt.id,
                    cleanupKey: reserved.attempt.cleanupKey,
                  },
                }
              )
              const published = await publishInvitedCredentials({
                snapshot,
                attempt: reserved.attempt,
                credentials,
                signal,
              })
              // The deadline wrapper may discard a late response. It must never emit its cookie on that error.
              signal.throwIfAborted()
              const safe = invitationFlowAuthResponseSchema.parse({
                binding: published.binding,
                data: { user: published.user },
                handoff: { attemptId: published.attemptId },
              })
              publishedSessionId = published.sessionId
              return safe
            } catch (error) {
              await recoverFailedInvitationAuth({
                request,
                snapshot,
                attempt: reserved.attempt,
                error,
                store: deps.store,
              }).catch(() => undefined)
              throw error
            }
          })
        },
        15000
      ),
    kind === 'login' ? 200 : 201
  )
  if (!response.ok || !publishedSessionId) return response
  const result = new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  })
  result.cookies.set(SESSION_COOKIE_NAME, publishedSessionId, sessionCookieOptions())
  return result
}
