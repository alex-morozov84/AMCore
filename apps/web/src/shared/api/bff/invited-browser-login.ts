import { NextResponse } from 'next/server'
import {
  invitationFlowAuthResponseSchema,
  passwordLoginResponseSchema,
  publicationAcknowledgedSchema,
} from '@amcore/shared'

import {
  type BrowserAuthFlow,
  type BrowserAuthPublication,
  updateBrowserAuthAttempt,
} from './browser-auth-attempt'
import { postBrowserAuth } from './browser-auth-upstream'
import {
  changedBrowserContext,
  createBrowserBindingVerifier,
  unavailableBrowserContext,
} from './browser-binding.server'
import { contextSessionBinding } from './context-session'
import { publishInvitedCredentials } from './invitation-auth-publication'
import { confirmInvitationAuth } from './invitation-auth-transition'
import { invitationContextDeps } from './invitation-context-deps'
import { invitationFlowChanged } from './invitation-flow-authority'
import { withInvitationOwnerLease } from './invitation-owner-lease'
import { invitationOwnerStore } from './invitation-owner-store'
import { invitationRequestAuthority } from './invitation-request-authority'
import { captureInvitationRequest } from './invitation-request-snapshot'
import type { ProductWebContext } from './product-web-context.server'
import type { VaultEntry } from './session-vault.types'

import 'server-only'

/** Preserve the original attempt fence; the server's fixed MFA deadline bounds the wait. */
export async function retainInvitedMfaDeadline(
  request: Request,
  context: ProductWebContext,
  record: BrowserAuthFlow
) {
  const invitation = record.invitation
  if (!invitation) throw invitationFlowChanged()
  const deps = await invitationContextDeps(request, { flowId: invitation.flowId })
  await withInvitationOwnerLease(
    invitation.ownerHash,
    request.signal,
    async () => {
      const snapshot = await captureInvitationRequest(request, invitation.flowId, deps, true)
      const attempt = snapshot.flow.attempt
      if (
        snapshot.ownerHash !== invitation.ownerHash ||
        snapshot.owner.epoch !== invitation.ownerEpoch ||
        attempt?.id !== invitation.attemptId ||
        attempt.fence !== invitation.fence ||
        attempt.cleanupKey !== invitation.cleanupKey
      )
        throw invitationFlowChanged()
      const next = {
        ...snapshot.owner,
        flows: snapshot.owner.flows.map((flow) =>
          flow === snapshot.flow
            ? {
                ...flow,
                attempt: { ...attempt, expiresAt: Math.min(flow.expiresAt, record.expiresAt) },
              }
            : flow
        ),
      }
      if (
        !(await invitationOwnerStore.compareAndSet(
          invitation.ownerHash,
          snapshot.owner.version,
          next,
          context
        ))
      )
        throw invitationFlowChanged()
    },
    undefined,
    context
  )
}

/** Owner fencing supplements the shared primary publication protocol; it never grants membership. */
export async function completeInvitedBrowserLogin(
  request: Request,
  context: ProductWebContext,
  handle: string,
  flow: BrowserAuthFlow,
  operationId: string,
  publicationCommandId?: string
): Promise<NextResponse> {
  const invitation = flow.invitation
  if (!invitation) throw changedBrowserContext()
  const deps = await invitationContextDeps(request, { flowId: invitation.flowId })
  if (
    deps.webContext?.frontend !== context.frontend ||
    deps.webContext.audience !== context.audience
  )
    throw invitationFlowChanged()
  return withInvitationOwnerLease(
    invitation.ownerHash,
    request.signal,
    async () => {
      const snapshot = await captureInvitationRequest(request, invitation.flowId, deps, true)
      const attempt = snapshot.flow.attempt
      if (
        snapshot.ownerHash !== invitation.ownerHash ||
        snapshot.owner.epoch !== invitation.ownerEpoch ||
        !attempt ||
        attempt.id !== invitation.attemptId ||
        attempt.fence !== invitation.fence ||
        attempt.cleanupKey !== invitation.cleanupKey
      )
        throw invitationFlowChanged()
      const issuing = await updateBrowserAuthAttempt(
        handle,
        flow,
        {
          ...flow,
          state: 'issuing',
          completionId: operationId,
          ...(publicationCommandId ? { publicationCommandId } : {}),
        },
        context
      )
      if (issuing.state !== 'issuing') throw changedBrowserContext()
      try {
        const upstream = await postBrowserAuth(
          request,
          context,
          issuing,
          '/auth/mfa/complete',
          { purpose: flow.flow.purpose, operationId, vaultBinding: flow.vaultBinding },
          flow.flow.continuation
        )
        return await stageInvitedBrowserCredentials(request, context, handle, issuing, upstream)
      } catch (error) {
        await postBrowserAuth(
          request,
          context,
          issuing,
          '/auth/mfa/publication/retire',
          { purpose: flow.flow.purpose, operationId },
          flow.flow.continuation
        ).catch(() => undefined)
        await updateBrowserAuthAttempt(
          handle,
          issuing,
          { ...issuing, state: 'cleanup_needed' },
          context
        ).catch(() => undefined)
        throw error
      }
    },
    undefined,
    context
  )
}

/** Caller holds the exact owner lease; credentials came from one completed API transaction. */
export async function stageInvitedBrowserCredentials(
  request: Request,
  context: ProductWebContext,
  handle: string,
  issuing: BrowserAuthFlow,
  upstream: Awaited<ReturnType<typeof postBrowserAuth>>,
  expectedStatus: 200 | 201 = 200
): Promise<NextResponse> {
  const flow = issuing,
    operationId = issuing.completionId,
    invitation = issuing.invitation
  if (!invitation) throw invitationFlowChanged()
  const deps = await invitationContextDeps(request, { flowId: invitation.flowId })
  const snapshot = await captureInvitationRequest(request, invitation.flowId, deps, true)
  const attempt = snapshot.flow.attempt
  if (
    snapshot.ownerHash !== invitation.ownerHash ||
    snapshot.owner.epoch !== invitation.ownerEpoch ||
    attempt?.id !== invitation.attemptId ||
    attempt.fence !== invitation.fence ||
    attempt.cleanupKey !== invitation.cleanupKey
  )
    throw invitationFlowChanged()
  const parsed = passwordLoginResponseSchema.safeParse(upstream.body)
  if (
    upstream.status !== expectedStatus ||
    !parsed.success ||
    !upstream.refreshToken ||
    !parsed.data.publication?.browser
  )
    throw unavailableBrowserContext()
  const publication = parsed.data.publication
  if (
    publication.continuation !== flow.flow.continuation ||
    publication.operationId !== operationId ||
    publication.browser!.contextId !== flow.browser.contextId ||
    publication.browser!.generation !== flow.browser.generation ||
    publication.browser!.audience !== context.audience
  )
    throw changedBrowserContext()
  const browser = {
    ...publication.browser!,
    familyId: publication.familyId,
    securityVersion: publication.securityVersion,
  }
  const metadata = {
    ...publication,
    purpose: flow.flow.purpose,
    vaultBinding: flow.vaultBinding,
    flowBinding: flow.id,
  }
  const retained = await publishInvitedCredentials({
    snapshot,
    attempt,
    signal: request.signal,
    credentials: { data: parsed.data, refreshToken: upstream.refreshToken },
    browserBinding: browser,
    publication: metadata,
  })
  const entry = await context.store.get(retained.sessionId)
  if (
    !entry ||
    entry.browser?.familyId !== publication.familyId ||
    entry.browser.generation !== flow.browser.generation
  )
    throw changedBrowserContext()
  const staged: BrowserAuthPublication = {
    ...issuing,
    state: 'staged',
    vaultId: retained.sessionId,
    receipt: publication.receipt,
    familyId: publication.familyId,
    securityVersion: publication.securityVersion,
    expiresAt: Math.min(flow.expiresAt, Date.now() + 60000),
  }
  const current = await updateBrowserAuthAttempt(handle, issuing, staged, context)
  if (current.state !== 'staged') throw changedBrowserContext()
  return settleRetainedInvitation(request, context, handle, current, entry)
}

/** Unknown-result continuation repeats only exact idempotent settlement, never credential issuance. */
export async function resumeInvitedBrowserPublication(
  request: Request,
  context: ProductWebContext,
  handle: string,
  staged: BrowserAuthPublication,
  publicationConfirmed = false
): Promise<NextResponse> {
  const invitation = staged.invitation
  if (!invitation) throw changedBrowserContext()
  return withInvitationOwnerLease(
    invitation.ownerHash,
    request.signal,
    async () => {
      const entry = await context.store.get(staged.vaultId)
      if (!entry) throw changedBrowserContext()
      return settleRetainedInvitation(request, context, handle, staged, entry, publicationConfirmed)
    },
    undefined,
    context
  )
}

async function settleRetainedInvitation(
  request: Request,
  context: ProductWebContext,
  handle: string,
  staged: BrowserAuthPublication,
  entry: VaultEntry,
  publicationConfirmed = false
): Promise<NextResponse> {
  const invitation = staged.invitation!
  const authority = invitationRequestAuthority(request, true, context)
  if (authority.ownerHash !== invitation.ownerHash) throw invitationFlowChanged()
  const owner = await invitationOwnerStore.get(invitation.ownerHash, context.origin, context)
  const flow = owner?.flows.find((candidate) => candidate.binding.flowId === invitation.flowId)
  const handoff = flow?.handoff
  const metadata = handoff?.publication
  if (
    !owner ||
    owner.epoch !== invitation.ownerEpoch + 1 ||
    !flow ||
    !handoff ||
    !metadata ||
    handoff.attemptId !== invitation.attemptId ||
    handoff.cleanupKey !== invitation.cleanupKey ||
    handoff.newSessionId !== staged.vaultId ||
    metadata.flowBinding !== staged.id ||
    metadata.operationId !== staged.completionId ||
    metadata.continuation !== staged.flow.continuation ||
    metadata.vaultBinding !== staged.vaultBinding ||
    entry.browser?.familyId !== staged.familyId ||
    entry.browser?.generation !== staged.browser.generation
  )
    throw invitationFlowChanged()
  if (!publicationConfirmed) {
    const ack = await postBrowserAuth(
      request,
      context,
      staged,
      '/auth/browser-publications/invitation-confirm',
      {
        purpose: staged.flow.purpose,
        operationId: staged.completionId,
        vaultBinding: staged.vaultBinding,
        accessToken: entry.accessToken,
        receipt: staged.receipt,
        handoff: { attemptId: invitation.attemptId, cleanupKey: invitation.cleanupKey },
      },
      staged.flow.continuation
    )
    if (ack.status !== 200 || !publicationAcknowledgedSchema.safeParse(ack.body).success)
      throw unavailableBrowserContext()
  }
  await createBrowserBindingVerifier(request.headers, context.audience)(entry)
  const next = confirmInvitationAuth(
    owner,
    flow.binding,
    flow.binding.sessionBinding!,
    invitation.attemptId,
    Date.now()
  )
  if (
    next !== owner &&
    !(await invitationOwnerStore.compareAndSet(invitation.ownerHash, owner.version, next, context))
  )
    throw invitationFlowChanged()
  await updateBrowserAuthAttempt(handle, staged, { ...staged, state: 'published' }, context)
  const response = NextResponse.json(
    invitationFlowAuthResponseSchema.parse({
      binding: flow.binding,
      data: {
        user: entry.userSnapshot,
        contextSession: contextSessionBinding(staged.vaultId, entry),
      },
      handoff: { attemptId: invitation.attemptId },
    })
  )
  response.cookies.set(context.cookieName, staged.vaultId, context.cookieOptions)
  return response
}
