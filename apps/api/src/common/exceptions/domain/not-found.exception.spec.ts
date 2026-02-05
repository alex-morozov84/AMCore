import { HttpStatus } from '@nestjs/common'

import { NotFoundException } from './not-found.exception'

describe('NotFoundException', () => {
  it('should create exception with resource and identifier', () => {
    const exception = new NotFoundException('Workout', '123')

    expect(exception.getStatus()).toBe(HttpStatus.NOT_FOUND)

    const response = exception.getResponse() as any
    expect(response.message).toBe('Workout with ID 123 not found')
    expect(response.errorCode).toBe('RESOURCE_NOT_FOUND')
    expect(response.details).toEqual({
      resource: 'Workout',
      identifier: '123',
    })
  })

  it('should work with numeric identifier', () => {
    const exception = new NotFoundException('User', 456)

    const response = exception.getResponse() as any
    expect(response.message).toBe('User with ID 456 not found')
    expect(response.details.identifier).toBe(456)
  })

  it('should work without identifier', () => {
    const exception = new NotFoundException('Settings')

    const response = exception.getResponse() as any
    expect(response.message).toBe('Settings not found')
    expect(response.details).toEqual({
      resource: 'Settings',
      identifier: undefined,
    })
  })
})
