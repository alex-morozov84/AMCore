import { isOrganizationContextId } from '@amcore/shared'

import { InvitationBackendError } from './invitation-upstream'
import { readIssuedAccessTokenClaims } from './issued-access-token'

import 'server-only'

/** Read correlation from a just-issued token received through the trusted API transport.
 * This is not JWT authentication: the API independently verifies JWT+actor+sid on confirmation.
 */
export function invitationIssuedSessionId(accessToken: string, expectedActorId: string): string {
  const claims = readIssuedAccessTokenClaims(accessToken)
  if (
    !claims ||
    typeof claims !== 'object' ||
    !('sub' in claims) ||
    claims.sub !== expectedActorId ||
    !('sid' in claims) ||
    typeof claims.sid !== 'string' ||
    !isOrganizationContextId(claims.sid)
  )
    throw new InvitationBackendError(503, false)
  return claims.sid
}
