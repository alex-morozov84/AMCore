import { isOrganizationContextId } from '@amcore/shared'

import { InvitationBackendError } from './invitation-upstream'

import 'server-only'

/** Read correlation from a just-issued token received through the trusted API transport.
 * This is not JWT authentication: the API independently verifies JWT+actor+sid on confirmation.
 */
export function invitationIssuedSessionId(accessToken: string, expectedActorId: string): string {
  if (accessToken.length > 8192) throw new InvitationBackendError(503, false)
  const parts = accessToken.split('.')
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part)))
    throw new InvitationBackendError(503, false)
  let claims: unknown
  try {
    claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'))
  } catch {
    throw new InvitationBackendError(503, false)
  }
  if (!claims || typeof claims !== 'object' || !('sub' in claims) || claims.sub !== expectedActorId ||
    !('sid' in claims) || typeof claims.sid !== 'string' || !isOrganizationContextId(claims.sid))
    throw new InvitationBackendError(503, false)
  return claims.sid
}
