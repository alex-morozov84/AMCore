import { randomBytes } from 'node:crypto'

import { NextResponse } from 'next/server'
import { invitationAdmissionResponseSchema, invitationAdmissionSchema, localizedFrontendUrl, type SupportedLocale } from '@amcore/shared'

import { withinContextDeadline } from './context-deadline'
import { ContextRequestError } from './context-errors'
import type { ContextExecutorDeps } from './context-executor'
import { attachInvitationBootstrap, readInvitationBootstrap, saveInvitationBootstrap } from './invitation-bootstrap-store'
import { invitationOwnerMaxAge } from './invitation-cookie'
import { admitInvitationFlow, invitationFlowChanged, newInvitationOwner } from './invitation-flow-authority'
import { withInvitationOwnerLease } from './invitation-owner-lease'
import { invitationOwnerHash, invitationOwnerStore } from './invitation-owner-store'
import { invitationCanonicalOrigin } from './invitation-render-request'
import { invitationRequestAuthority } from './invitation-request-authority'
import { invitationIncomingSession } from './invitation-request-snapshot'
import { invitationRoute } from './invitation-route'
import { invitationBackend } from './invitation-upstream'

import 'server-only'

function redirect(request: Request, locale: SupportedLocale, path: string) {
  const response = NextResponse.redirect(localizedFrontendUrl(invitationCanonicalOrigin(request.headers, request.url), locale, path), 303)
  response.headers.set('cache-control', 'private, no-store')
  response.headers.set('referrer-policy', 'no-referrer')
  response.headers.set('x-robots-tag', 'noindex, nofollow')
  return response
}

/** Raw email tokens never enter rendered props, flow URLs or Redis records. GET never joins. */
export async function invitationIngress(request: Request, locale: SupportedLocale, deps: ContextExecutorDeps) {
  let destination: string | undefined
  let cookie: { name: string; proof: string; expiresAt: number; options: ReturnType<typeof invitationRequestAuthority>['policy']['options'] } | undefined
  const result = await invitationRoute(request, () => withinContextDeadline(request.signal, async signal => {
    const authority = invitationRequestAuthority(request, false)
    const query = new URL(request.url).searchParams
    if (query.size !== 1 || query.getAll('token').length !== 1) throw new ContextRequestError(400, 'BAD_REQUEST')
    const body = invitationAdmissionSchema.parse({ token: query.get('token') })
    const session = await invitationIncomingSession(deps)
    const existing = authority.ownerHash ? await invitationOwnerStore.get(authority.ownerHash, authority.policy.origin) : null
    if (!existing) {
      const proof = randomBytes(32).toString('base64url')
      const hash = invitationOwnerHash(proof)
      const owner = newInvitationOwner(authority.policy.origin, session?.binding ?? null, Date.now())
      signal.throwIfAborted()
      if (!await invitationOwnerStore.create(hash, owner)) throw invitationFlowChanged()
      const admission = await invitationBackend('/auth/invites/continuations', invitationAdmissionResponseSchema, {
        source: request.headers, signal, method: 'POST', expectedStatus: 201, body,
      })
      signal.throwIfAborted()
      const pendingId = await saveInvitationBootstrap(hash, authority.policy.origin, locale, admission.data, Date.now())
      signal.throwIfAborted()
      destination = `invite/bootstrap/${pendingId}`
      cookie = { name: authority.policy.name, proof, expiresAt: owner.expiresAt, options: authority.policy.options }
      return {}
    }
    return withInvitationOwnerLease(authority.ownerHash!, signal, async () => {
      const owner = await invitationOwnerStore.get(authority.ownerHash!, authority.policy.origin)
      if (!owner || owner.sessionBinding !== (session?.binding ?? null)) throw invitationFlowChanged()
      const admission = await invitationBackend('/auth/invites/continuations', invitationAdmissionResponseSchema, {
        source: request.headers, signal, method: 'POST', expectedStatus: 201, body,
      })
      const admitted = admitInvitationFlow(owner, admission.data, locale, session?.binding ?? null, Date.now())
      signal.throwIfAborted()
      if (!await invitationOwnerStore.compareAndSet(authority.ownerHash!, owner.version, admitted.owner)) throw invitationFlowChanged()
      signal.throwIfAborted()
      destination = `invite/flow/${admitted.flow.binding.flowId}`
      return {}
    })
  }, 10000))
  if (!result.ok || !destination) return redirect(request, locale, result.status >= 500 ? 'invite/unusable?reason=unavailable' : 'invite/unusable')
  const response = redirect(request, locale, destination)
  if (cookie) response.cookies.set(cookie.name, cookie.proof, { ...cookie.options,
    maxAge: invitationOwnerMaxAge(cookie.expiresAt, Date.now()) })
  return response
}

/** Confirm against the CURRENT browser proof, not the cookie candidate from the first response. */
export async function invitationBootstrap(request: Request, locale: SupportedLocale, pendingId: string, deps: ContextExecutorDeps) {
  let destination: string | undefined
  const result = await invitationRoute(request, () => withinContextDeadline(request.signal, async signal => {
    if (new URL(request.url).search) throw new ContextRequestError(400, 'BAD_REQUEST')
    const authority = invitationRequestAuthority(request, false)
    if (!authority.ownerHash) throw invitationFlowChanged()
    return withInvitationOwnerLease(authority.ownerHash, signal, async () => {
      const [owner, pending, session] = await Promise.all([
        invitationOwnerStore.get(authority.ownerHash!, authority.policy.origin),
        readInvitationBootstrap(pendingId, authority.ownerHash!, authority.policy.origin),
        invitationIncomingSession(deps),
      ])
      if (!owner || !pending || pending.locale !== locale) throw invitationFlowChanged()
      const admitted = admitInvitationFlow(owner, pending.admission, locale, session?.binding ?? null, Date.now())
      signal.throwIfAborted()
      if (!await attachInvitationBootstrap(pendingId, authority.ownerHash!, owner.version, admitted.owner, admitted.flow.binding.flowId))
        throw invitationFlowChanged()
      signal.throwIfAborted()
      destination = `invite/flow/${admitted.flow.binding.flowId}`
      return {}
    })
  }, 10000))
  return redirect(request, locale, result.ok && destination ? destination : 'invite/unusable')
}
