import { AuthErrorCode } from '@amcore/shared'

import { ContextRequestError } from './context-errors'
import { invitationCookiePolicy, readInvitationOwner } from './invitation-cookie'
import { invitationOwnerHash } from './invitation-owner-store'
import { invitationCanonicalOrigin } from './invitation-render-request'

import 'server-only'

/** Select the configured public origin by actual Host; Next may expose an internal request URL. */
export function invitationRequestAuthority(request: Request, mutation: boolean) {
  const policy = invitationCookiePolicy(invitationCanonicalOrigin(request.headers, request.url))
  const trusted = (process.env.WEB_TRUSTED_ORIGINS ?? 'http://localhost:3002')
    .split(',')
    .map((origin) => origin.trim())
  if (!trusted.includes(policy.origin)) throw new ContextRequestError(403, 'FORBIDDEN')
  if (mutation && request.headers.get('origin') !== policy.origin)
    throw new ContextRequestError(403, AuthErrorCode.AUTH_ORIGIN_REJECTED)
  let proof: string | null
  try {
    proof = readInvitationOwner(request.headers.get('cookie'), policy.name)
  } catch {
    throw new ContextRequestError(400, 'BAD_REQUEST')
  }
  return { policy, ownerHash: proof === null ? null : invitationOwnerHash(proof) }
}
