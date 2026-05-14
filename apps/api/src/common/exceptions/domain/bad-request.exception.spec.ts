import { HttpStatus } from '@nestjs/common'

import { BadRequestException } from './bad-request.exception'

describe('BadRequestException', () => {
  it('should default to generic message and BAD_REQUEST code', () => {
    const exception = new BadRequestException()

    expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST)

    const response = exception.getResponse() as any
    expect(response.message).toBe('Bad request')
    expect(response.errorCode).toBe('BAD_REQUEST')
  })

  it('should accept custom message and details', () => {
    const exception = new BadRequestException('Invalid pagination cursor', {
      cursor: 'abc',
    })

    const response = exception.getResponse() as any
    expect(response.message).toBe('Invalid pagination cursor')
    expect(response.errorCode).toBe('BAD_REQUEST')
    expect(response.details).toEqual({ cursor: 'abc' })
  })
})
