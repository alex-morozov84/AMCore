import { HttpStatus } from '@nestjs/common'

import { ConflictException } from './conflict.exception'

describe('ConflictException', () => {
  it('should create exception with message', () => {
    const exception = new ConflictException('Resource already exists')

    expect(exception.getStatus()).toBe(HttpStatus.CONFLICT)

    const response = exception.getResponse() as any
    expect(response.message).toBe('Resource already exists')
    expect(response.errorCode).toBe('CONFLICT')
  })

  it('should include details', () => {
    const exception = new ConflictException('Email already registered', {
      email: 'user@example.com',
    })

    const response = exception.getResponse() as any
    expect(response.message).toBe('Email already registered')
    expect(response.details).toEqual({
      email: 'user@example.com',
    })
  })
})
