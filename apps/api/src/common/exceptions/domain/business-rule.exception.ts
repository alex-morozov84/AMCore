import { HttpStatus } from '@nestjs/common'

import { AppException } from './app.exception'

/**
 * Business rule violation exception
 * Used when business logic constraints are not met
 */
export class BusinessRuleViolationException extends AppException {
  constructor(rule: string, details?: Record<string, unknown>) {
    super(`Business rule violation: ${rule}`, HttpStatus.BAD_REQUEST, 'BUSINESS_RULE_VIOLATION', {
      rule,
      ...details,
    })
  }
}
