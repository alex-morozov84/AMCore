import { AuthErrorCode } from '@amcore/shared'

import { AppException, ServiceUnavailableException } from '../../../common/exceptions/index.js'

import type { SessionAdmission } from './mfa-session-authority.js'

/** A terminal authority refusal cannot enter a 401 refresh or credential-selection fallback. */
export function requireMfaAdmission(
  result: SessionAdmission
): Extract<SessionAdmission, { kind: 'admitted' }> {
  if (result.kind === 'admitted') return result
  if (result.reason === 'enforcement_unavailable')
    throw new ServiceUnavailableException('MFA admission unavailable')
  throw new AppException('Session authority changed', 409, AuthErrorCode.SESSION_CHANGED)
}
