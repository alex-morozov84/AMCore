import { HttpStatus } from '@nestjs/common'

import { BusinessRuleViolationException } from './business-rule.exception'

describe('BusinessRuleViolationException', () => {
  it('should create exception with rule name', () => {
    const exception = new BusinessRuleViolationException('Cannot delete active workout')

    expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST)

    const response = exception.getResponse() as any
    expect(response.message).toBe('Business rule violation: Cannot delete active workout')
    expect(response.errorCode).toBe('BUSINESS_RULE_VIOLATION')
    expect(response.details).toEqual({
      rule: 'Cannot delete active workout',
    })
  })

  it('should include additional details', () => {
    const exception = new BusinessRuleViolationException('Max exercises exceeded', {
      maxExercises: 10,
      currentCount: 12,
    })

    const response = exception.getResponse() as any
    expect(response.details).toEqual({
      rule: 'Max exercises exceeded',
      maxExercises: 10,
      currentCount: 12,
    })
  })
})
