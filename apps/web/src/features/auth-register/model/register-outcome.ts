import { AuthErrorCode } from '@amcore/shared'

import { ClientErrorCode } from '@/shared/api/error-codes'
import { getErrorCode, getErrorStatus, resolveErrorCode } from '@/shared/api/errors'

/**
 * What a failed registration tells the person:
 * - `created`: the API confirmed the account; only the browser session is missing.
 * - `unknown`: no usable answer (server error or lost connection). The account may or may not exist.
 * - `other`: an ordinary refusal such as a validation error or `409`; show it as usual.
 */
export type RegisterOutcome = 'created' | 'unknown' | 'other'

export function classifyRegisterError(error: unknown): RegisterOutcome {
  if (!error) return 'other'
  if (getErrorCode(error) === AuthErrorCode.REGISTRATION_SIGN_IN_REQUIRED) return 'created'
  if (resolveErrorCode(error) === ClientErrorCode.NETWORK_ERROR) return 'unknown'
  const status = getErrorStatus(error)
  return status !== undefined && status >= 500 ? 'unknown' : 'other'
}
