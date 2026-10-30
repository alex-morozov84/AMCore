import { NextResponse } from 'next/server'
import {
  authResponseSchema,
  invitationFlowAuthResponseSchema,
  invitationFlowLoginSchema,
  invitationFlowRegisterSchema,
  passwordLoginResponseSchema,
} from '@amcore/shared'

import { type BrowserAuthFlow, readBrowserAuthAttempt } from './browser-auth-attempt'
import { postBrowserAuth } from './browser-auth-upstream'
import { completeBrowserLogin, handleBrowserPassword } from './browser-login-handler'
import { prepareBrowserRegistration } from './browser-registration'
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
import { invitationBackend, InvitationBackendError } from './invitation-upstream'
import { stageInvitedBrowserCredentials } from './invited-browser-login'
import { withCreatedOutcome } from './registration-outcome'
import { SESSION_COOKIE_NAME, sessionCookieOptions } from './session-cookie'

import 'server-only'

export async function invitationCredentialHandler(
  request: Request,
  flowId: string,
  kind: 'login' | 'register',
  deps: ContextExecutorDeps
) {
  let pendingLogin: { handle: string; record: BrowserAuthFlow } | undefined
  let pendingHuman = false
  let publishedSessionId: string | undefined
  // Request-local evidence: set only after the API confirmed registration (exact 201,
  // valid body, signal alive). Read by the wrapper OUTSIDE the deadline race.
  let created = false
  const response = await invitationRoute(
    request,
    () =>
      withCreatedOutcome(
        () => created,
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
              const outcome = await withInvitationOwnerLease(
                first.ownerHash,
                signal,
                async () => {
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
                      reserved.owner,
                      deps.webContext
                    ))
                  )
                    throw invitationFlowChanged()
                  try {
                    signal.throwIfAborted()
                    if (kind === 'login') {
                      if (!deps.webContext)
                        throw new ContextRequestError(503, 'SERVICE_UNAVAILABLE')
                      const started = await handleBrowserPassword(request, deps.webContext, body, {
                        ownerHash: snapshot.ownerHash,
                        ownerEpoch: reserved.attempt.ownerEpoch,
                        flowId,
                        attemptId: reserved.attempt.id,
                        fence: reserved.attempt.fence,
                        cleanupKey: reserved.attempt.cleanupKey,
                        credential: snapshot.flow.credential,
                      })
                      const current = await readBrowserAuthAttempt(request.headers, deps.webContext)
                      if (!current || current.record.state !== 'flow') throw invitationFlowChanged()
                      pendingLogin = { handle: current.handle, record: current.record }
                      pendingHuman = current.record.flow.nextAction !== 'complete'
                      if (pendingHuman) {
                        const owner = await invitationOwnerStore.get(
                          snapshot.ownerHash,
                          snapshot.owner.origin,
                          deps.webContext
                        )
                        const target = owner?.flows.find((flow) => flow.binding.flowId === flowId)
                        if (
                          !owner ||
                          target?.attempt?.id !== reserved.attempt.id ||
                          target.attempt.fence !== reserved.attempt.fence
                        )
                          throw invitationFlowChanged()
                        const next = {
                          ...owner,
                          flows: owner.flows.map((flow) =>
                            flow === target
                              ? {
                                  ...flow,
                                  attempt: {
                                    ...target.attempt!,
                                    expiresAt: Math.min(target.expiresAt, current.record.expiresAt),
                                  },
                                }
                              : flow
                          ),
                        }
                        if (
                          !(await invitationOwnerStore.compareAndSet(
                            snapshot.ownerHash,
                            owner.version,
                            next,
                            deps.webContext
                          ))
                        )
                          throw invitationFlowChanged()
                      }
                      return started.json()
                    }
                    if (deps.webContext) {
                      const prepared = await prepareBrowserRegistration(request, deps.webContext, {
                        ownerHash: snapshot.ownerHash,
                        ownerEpoch: reserved.attempt.ownerEpoch,
                        flowId,
                        attemptId: reserved.attempt.id,
                        fence: reserved.attempt.fence,
                        cleanupKey: reserved.attempt.cleanupKey,
                      })
                      const issued = await postBrowserAuth(
                        request,
                        deps.webContext,
                        prepared.previous,
                        '/auth/invites/register',
                        body,
                        prepared.intent.continuation,
                        undefined,
                        {
                          credential: snapshot.flow.credential,
                          attemptId: reserved.attempt.id,
                          cleanupKey: reserved.attempt.cleanupKey,
                        },
                        prepared.intent
                      )
                      if (
                        issued.status !== 201 ||
                        !passwordLoginResponseSchema.safeParse(issued.body).success
                      )
                        throw new InvitationBackendError(503, false)
                      created = true
                      const completed = await stageInvitedBrowserCredentials(
                        request,
                        deps.webContext,
                        prepared.handle,
                        prepared.record,
                        issued,
                        201
                      )
                      signal.throwIfAborted()
                      publishedSessionId = completed.cookies.get(deps.webContext.cookieName)?.value
                      return invitationFlowAuthResponseSchema.parse(await completed.json())
                    }
                    const credentials = await invitationBackend(
                      '/auth/invites/register',
                      authResponseSchema,
                      {
                        context: deps.webContext,
                        source: request.headers,
                        signal,
                        method: 'POST',
                        expectedStatus: 201,
                        body,
                        credential: snapshot.flow.credential,
                        handoff: {
                          attemptId: reserved.attempt.id,
                          cleanupKey: reserved.attempt.cleanupKey,
                        },
                      }
                    )
                    created = true
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
                  } catch (failure) {
                    const error =
                      failure instanceof ContextRequestError &&
                      [400, 401, 403, 409, 422, 429].includes(failure.status)
                        ? new InvitationBackendError(
                            failure.status,
                            true,
                            failure.errorCode,
                            failure.retryAfterSeconds
                          )
                        : failure
                    await recoverFailedInvitationAuth({
                      request,
                      snapshot,
                      attempt: reserved.attempt,
                      error,
                      store: deps.store,
                    }).catch(() => undefined)
                    throw error
                  }
                },
                undefined,
                deps.webContext
              )
              if (pendingLogin && !pendingHuman && deps.webContext) {
                const completed = await completeBrowserLogin(
                  request,
                  deps.webContext,
                  pendingLogin.handle,
                  pendingLogin.record
                )
                publishedSessionId = completed.cookies.get(deps.webContext.cookieName)?.value
                return invitationFlowAuthResponseSchema.parse(await completed.json())
              }
              return outcome
            },
            15000
          )
      ),
    kind === 'login' ? 200 : 201
  )
  if (response.ok && pendingHuman)
    return new NextResponse(response.body, { status: 202, headers: response.headers })
  if (!response.ok || !publishedSessionId) return response
  const result = new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  })
  result.cookies.set(
    deps.webContext?.cookieName ?? SESSION_COOKIE_NAME,
    publishedSessionId,
    deps.webContext?.cookieOptions ?? sessionCookieOptions()
  )
  return result
}
