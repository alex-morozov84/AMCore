import { HttpStatus } from '@nestjs/common'

import { UnauthorizedException } from './unauthorized.exception'

describe('UnauthorizedException', () => {
  it('should default to generic message and UNAUTHORIZED code', () => {
    const exception = new UnauthorizedException()

    expect(exception.getStatus()).toBe(HttpStatus.UNAUTHORIZED)

    const response = exception.getResponse() as any
    expect(response.message).toBe('Unauthorized')
    expect(response.errorCode).toBe('UNAUTHORIZED')
  })

  it('should accept custom message', () => {
    const exception = new UnauthorizedException('Invalid token')

    const response = exception.getResponse() as any
    expect(response.message).toBe('Invalid token')
    expect(response.errorCode).toBe('UNAUTHORIZED')
  })

  it('should include details', () => {
    const exception = new UnauthorizedException('Token expired', { reason: 'exp' })

    const response = exception.getResponse() as any
    expect(response.details).toEqual({ reason: 'exp' })
  })
})
