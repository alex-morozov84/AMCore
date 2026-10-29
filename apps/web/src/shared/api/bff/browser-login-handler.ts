import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'
import {
  passwordLoginPendingSchema,
  passwordLoginResponseSchema,
  publicationAcknowledgedSchema,
} from '@amcore/shared'

import {
  type BrowserAuthAttempt,
  type BrowserAuthFlow,
  type BrowserAuthPublication,
  type InvitedBrowserAttempt,
  readBrowserAuthAttempt,
  updateBrowserAuthAttempt,
} from './browser-auth-attempt'
import { postBrowserAuth } from './browser-auth-upstream'
import {
  changedBrowserContext,
  createBrowserBindingVerifier,
  unavailableBrowserContext,
} from './browser-binding.server'
import { contextSessionBinding } from './context-session'
import {
  completeInvitedBrowserLogin,
  resumeInvitedBrowserPublication,
  retainInvitedMfaDeadline,
} from './invited-browser-login'
import type { ProductWebContext } from './product-web-context.server'
import { type VaultRecord } from './session-vault.types'
import { ACCESS_TOKEN_LIFETIME_MS } from './vault-constants'

import 'server-only'

/** The outer credential handler owns origin/schema checks; registration never enters this path. */
export async function handleBrowserPassword(
  request: Request,
  context: ProductWebContext,
  input: unknown,
  invitation?: InvitedBrowserAttempt & { credential: string }
): Promise<NextResponse> {
  const attempt = await readBrowserAuthAttempt(request.headers, context)
  if (
    !attempt ||
    attempt.record.state !== 'ready' ||
    attempt.record.invitation ||
    request.headers.get('x-amcore-login-attempt') !== attempt.record.id
  )
    throw changedBrowserContext()
  const started = await updateBrowserAuthAttempt(
    attempt.handle,
    attempt.record,
    { ...attempt.record, state: 'starting' },
    context
  )
  const upstream = await postBrowserAuth(
    request,
    context,
    started,
    '/auth/login',
    input,
    undefined,
    undefined,
    invitation
      ? {
          credential: invitation.credential,
          attemptId: invitation.attemptId,
          cleanupKey: invitation.cleanupKey,
        }
      : undefined
  )
  return retainBrowserLogin(
    request,
    context,
    attempt.handle,
    started,
    upstream,
    maskAccount(input),
    undefined,
    invitation
  )
}

/** OAuth exchanges only its exact callback-bound ticket after the neutral anchor round trip. */
export async function handleBrowserOAuth(
  request: Request,
  context: ProductWebContext,
  ticket: string,
  callbackBinding: string
): Promise<NextResponse> {
  const attempt = await readBrowserAuthAttempt(request.headers, context)
  if (!attempt || attempt.record.state !== 'ready') throw changedBrowserContext()
  const started = await updateBrowserAuthAttempt(
    attempt.handle,
    attempt.record,
    { ...attempt.record, state: 'starting' },
    context
  )
  const upstream = await postBrowserAuth(
    request,
    context,
    started,
    '/auth/oauth/exchange',
    { ticket },
    undefined,
    callbackBinding
  )
  const response = await retainBrowserLogin(
    request,
    context,
    attempt.handle,
    started,
    upstream,
    '',
    createHash('sha256').update(ticket).digest('hex'),
    started.invitation
  )
  if (!started.invitation) return response
  const retained = await readBrowserAuthAttempt(request.headers, context)
  if (!retained || retained.record.state !== 'flow') throw changedBrowserContext()
  await retainInvitedMfaDeadline(request, context, retained.record)
  if (retained.record.flow.nextAction !== 'complete') return response
  return completeBrowserLogin(request, context, retained.handle, retained.record)
}

async function retainBrowserLogin(
  request: Request,
  context: ProductWebContext,
  handle: string,
  started: BrowserAuthAttempt,
  upstream: Awaited<ReturnType<typeof postBrowserAuth>>,
  accountLabel: string,
  oauthTicketHash?: string,
  invitation?: InvitedBrowserAttempt
): Promise<NextResponse> {
  const pending = passwordLoginPendingSchema.safeParse(upstream.body)
  if (
    upstream.status !== 202 ||
    !pending.success ||
    !pending.data.browser ||
    pending.data.browser.contextId !== started.browser.contextId ||
    pending.data.browser.generation !== started.browser.generation + 1 ||
    upstream.refreshToken
  )
    throw unavailableBrowserContext()
  const flow = pending.data
  const next: BrowserAuthFlow = {
    ...started,
    state: 'flow',
    browser: flow.browser!,
    flow,
    completionId: randomUUID(),
    accountLabel: flow.accountLabel ?? accountLabel,
    ...(invitation
      ? {
          invitation: {
            ownerHash: invitation.ownerHash,
            ownerEpoch: invitation.ownerEpoch,
            flowId: invitation.flowId,
            attemptId: invitation.attemptId,
            fence: invitation.fence,
            cleanupKey: invitation.cleanupKey,
          },
        }
      : {}),
    ...(oauthTicketHash ? { oauthTicketHash } : {}),
    vaultBinding: randomBytes(32).toString('base64url'),
    expiresAt: Math.min(started.expiresAt, Date.parse(flow.expiresAt)),
  }
  const retained = await updateBrowserAuthAttempt(handle, started, next, context)
  if (retained.state !== 'flow') throw changedBrowserContext()
  if (invitation || flow.nextAction !== 'complete')
    return NextResponse.json({ kind: 'mfa', flowBinding: retained.id }, { status: 202 })
  const response = await completeBrowserLogin(request, context, handle, retained)
  if (flow.returnTo) response.headers.set('x-amcore-oauth-return', JSON.stringify(flow.returnTo))
  return response
}

/** Retain exact continuation/operation before issuance, then stage vault+journal atomically before acknowledgement. */
export async function completeBrowserLogin(
  request: Request,
  context: ProductWebContext,
  handle: string,
  flow: BrowserAuthFlow,
  operationId = flow.completionId,
  publicationCommandId?: string
): Promise<NextResponse> {
  if (flow.invitation)
    return completeInvitedBrowserLogin(
      request,
      context,
      handle,
      flow,
      operationId,
      publicationCommandId
    )
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
      {
        purpose: flow.flow.purpose,
        operationId: issuing.completionId,
        vaultBinding: flow.vaultBinding,
      },
      flow.flow.continuation
    )
    return await stageIssuedBrowserLogin(request, context, handle, issuing, upstream)
  } catch (error) {
    const latest = await readBrowserAuthAttempt(request.headers, context).catch(() => null)
    // A durable staged result can repeat its exact acknowledgement. A lost ACK
    // is not permission to destroy the retained credential reply.
    if (!latest || latest.record.state !== 'issuing' || latest.record.id !== issuing.id) throw error
    const fenced = await updateBrowserAuthAttempt(
      handle,
      latest.record,
      { ...latest.record, state: 'cleanup_needed' },
      context
    )
      .then(() => true)
      .catch(() => false)
    if (!fenced) throw error
    // Only the exact unpublished candidate can be retired; no published winner.
    await postBrowserAuth(
      request,
      context,
      issuing,
      '/auth/mfa/publication/retire',
      {
        purpose: issuing.flow.purpose,
        operationId: issuing.completionId,
      },
      issuing.flow.continuation
    ).catch(() => undefined)
    throw error
  }
}

/** Stage the one credential reply before primary acknowledgement; registration reuses this path. */
export async function stageIssuedBrowserLogin(
  request: Request,
  context: ProductWebContext,
  handle: string,
  issuing: BrowserAuthFlow,
  upstream: Awaited<ReturnType<typeof postBrowserAuth>>,
  expectedStatus: 200 | 201 = 200
): Promise<NextResponse> {
  const flow = issuing
  const issued = passwordLoginResponseSchema.safeParse(upstream.body)
  if (
    upstream.status !== expectedStatus ||
    !issued.success ||
    !upstream.refreshToken ||
    !issued.data.publication?.browser
  )
    throw unavailableBrowserContext()
  const credentials = issued.data
  const publication = credentials.publication!
  if (
    publication.continuation !== flow.flow.continuation ||
    publication.operationId !== issuing.completionId ||
    publication.browser!.contextId !== flow.browser.contextId ||
    publication.browser!.generation !== flow.browser.generation ||
    publication.browser!.audience !== context.audience
  )
    throw changedBrowserContext()
  const staged: BrowserAuthPublication = {
    ...issuing,
    state: 'staged',
    vaultId: randomBytes(32).toString('base64url'),
    receipt: publication.receipt,
    familyId: publication.familyId,
    securityVersion: publication.securityVersion,
    expiresAt: Math.min(flow.expiresAt, Date.now() + 60000),
  }
  const entry: VaultRecord = {
    audience: context.audience,
    accessToken: credentials.accessToken,
    refreshToken: upstream.refreshToken,
    accessTokenExpiresAt: Date.now() + ACCESS_TOKEN_LIFETIME_MS,
    userSnapshot: credentials.user,
    browser: {
      ...publication.browser!,
      familyId: publication.familyId,
      securityVersion: publication.securityVersion,
    },
  }
  const retained = await updateBrowserAuthAttempt(handle, issuing, staged, context, entry)
  if (retained.state !== 'staged') throw changedBrowserContext()
  return await publishBrowserLogin(request, context, handle, retained, entry)
}

export async function publishBrowserLogin(
  request: Request,
  context: ProductWebContext,
  handle: string,
  staged: BrowserAuthPublication,
  entry: VaultRecord
): Promise<NextResponse> {
  if (staged.invitation) return resumeInvitedBrowserPublication(request, context, handle, staged)
  const ack = await postBrowserAuth(
    request,
    context,
    staged,
    '/auth/mfa/publication/acknowledge',
    {
      purpose: staged.flow.purpose,
      operationId: staged.completionId,
      vaultBinding: staged.vaultBinding,
      accessToken: entry.accessToken,
      receipt: staged.receipt,
    },
    staged.flow.continuation
  )
  if (ack.status !== 200 || !publicationAcknowledgedSchema.safeParse(ack.body).success)
    throw unavailableBrowserContext()
  await createBrowserBindingVerifier(request.headers, context.audience)(entry)
  await updateBrowserAuthAttempt(handle, staged, { ...staged, state: 'published' }, context).catch(
    async (error) => {
      const current = await readBrowserAuthAttempt(request.headers, context)
      if (
        !current ||
        current.record.state !== 'published' ||
        current.record.id !== staged.id ||
        current.record.completionId !== staged.completionId ||
        current.record.vaultId !== staged.vaultId ||
        current.record.familyId !== staged.familyId
      )
        throw error
    }
  )
  const response = NextResponse.json({
    user: entry.userSnapshot,
    contextSession: contextSessionBinding(staged.vaultId, { ...entry, version: 1 }),
  })
  response.cookies.set(context.cookieName, staged.vaultId, context.cookieOptions)
  return response
}

function maskAccount(input: unknown): string {
  const email =
    input && typeof input === 'object' && 'email' in input && typeof input.email === 'string'
      ? input.email
      : ''
  const [name, domain] = email.split('@')
  return `${name?.slice(0, 2) ?? ''}...@${domain ?? ''}`
}
