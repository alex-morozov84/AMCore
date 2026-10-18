import { AppException } from '../../../common/exceptions/index.js'

export function provisioningError(code: string, status = 409): AppException {
  return new AppException(
    code,
    status,
    code,
    code === 'PROVISIONING_BUSY' ? { retryAfterSeconds: 1 } : undefined
  )
}
