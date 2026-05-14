import { HttpStatus } from '@nestjs/common'

import { ForbiddenException } from './forbidden.exception'

describe('ForbiddenException', () => {
  it('should default to generic message and FORBIDDEN code', () => {
    const exception = new ForbiddenException()

    expect(exception.getStatus()).toBe(HttpStatus.FORBIDDEN)

    const response = exception.getResponse() as any
    expect(response.message).toBe('Forbidden')
    expect(response.errorCode).toBe('FORBIDDEN')
  })

  it('should accept custom message and details', () => {
    const exception = new ForbiddenException('Cannot modify system role', {
      roleId: 'sys-admin',
    })

    const response = exception.getResponse() as any
    expect(response.message).toBe('Cannot modify system role')
    expect(response.errorCode).toBe('FORBIDDEN')
    expect(response.details).toEqual({ roleId: 'sys-admin' })
  })
})
