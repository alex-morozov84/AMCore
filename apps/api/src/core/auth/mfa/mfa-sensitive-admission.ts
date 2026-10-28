import { AuthErrorCode, type RequestPrincipal } from '@amcore/shared'

import { AppException } from '../../../common/exceptions/index.js'

import { requireMfaAdmission } from './mfa-admission-result.js'
import { type MfaAuthorityDatabase, MfaAuthorityReader } from './mfa-authority-reader.service.js'
import { principalBrowserBinding } from './mfa-principal-binding.js'

/** Returns false only for ordinary independent legacy password freshness. No locks acquired. */
export async function assertMfaSensitiveAdmission(
  db: MfaAuthorityDatabase,
  principal: RequestPrincipal,
  windowSec: number
): Promise<boolean> {
  const admission = requireMfaAdmission(
    await new MfaAuthorityReader(db).readForSensitiveAction(
      { ...principal, email: principal.email ?? '' },
      principalBrowserBinding(principal),
      windowSec
    )
  )
  const requiredProofs = admission.requiredProofs
  if (!requiredProofs) return false
  if (requiredProofs.length)
    throw new AppException('Step-up authentication required', 403, AuthErrorCode.STEP_UP_REQUIRED, {
      requiredProofs,
    })
  return true
}
