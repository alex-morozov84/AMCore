import { HttpStatus } from '@nestjs/common'

import { AppException } from './app.exception'

/**
 * Generic not found exception
 * Use specific domain exceptions (WorkoutNotFoundException) when possible
 */
export class NotFoundException extends AppException {
  constructor(resource: string, identifier?: string | number) {
    const message = identifier
      ? `${resource} with ID ${identifier} not found`
      : `${resource} not found`

    super(message, HttpStatus.NOT_FOUND, 'RESOURCE_NOT_FOUND', {
      resource,
      identifier,
    })
  }
}
