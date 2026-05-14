import { HttpStatus } from '@nestjs/common'

import { AppException } from './app.exception'

/**
 * Generic unauthorized exception (401)
 * Carries default errorCode 'UNAUTHORIZED'. Use AppException directly with a
 * specific code (e.g. AuthErrorCode.TOKEN_INVALID) when the cause is known.
 */
export class UnauthorizedException extends AppException {
  constructor(message = 'Unauthorized', details?: Record<string, unknown>) {
    super(message, HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', details)
  }
}
