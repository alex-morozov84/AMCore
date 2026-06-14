import { HttpStatus } from '@nestjs/common'

import { AppException } from './app.exception'

/**
 * Service-unavailable exception (503)
 * Used for transient, retriable failures — e.g. a lock that could not be
 * acquired or whose lease was lost — so clients know to back off and retry.
 */
export class ServiceUnavailableException extends AppException {
  constructor(
    message: string,
    errorCode = 'SERVICE_UNAVAILABLE',
    details?: Record<string, unknown>
  ) {
    super(message, HttpStatus.SERVICE_UNAVAILABLE, errorCode, details)
  }
}
