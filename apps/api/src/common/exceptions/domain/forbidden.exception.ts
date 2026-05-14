import { HttpStatus } from '@nestjs/common'

import { AppException } from './app.exception'

/**
 * Generic forbidden exception (403)
 * Carries default errorCode 'FORBIDDEN'. Use AppException directly with a
 * specific code when the policy decision has a meaningful machine name.
 */
export class ForbiddenException extends AppException {
  constructor(message = 'Forbidden', details?: Record<string, unknown>) {
    super(message, HttpStatus.FORBIDDEN, 'FORBIDDEN', details)
  }
}
