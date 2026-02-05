import { HttpStatus } from '@nestjs/common'

import { AppException } from './app.exception'

/**
 * Generic conflict exception (409)
 * Used when resource already exists or conflicts with current state
 */
export class ConflictException extends AppException {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, HttpStatus.CONFLICT, 'CONFLICT', details)
  }
}
