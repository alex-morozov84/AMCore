import { HttpStatus } from '@nestjs/common'

import { AppException } from './app.exception'

/**
 * Generic bad request exception (400)
 * Carries default errorCode 'BAD_REQUEST'. Prefer Zod / DTO validation for
 * field-level errors; use this for non-schema input violations.
 */
export class BadRequestException extends AppException {
  constructor(message = 'Bad request', details?: Record<string, unknown>) {
    super(message, HttpStatus.BAD_REQUEST, 'BAD_REQUEST', details)
  }
}
