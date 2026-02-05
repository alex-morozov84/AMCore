import { HttpStatus } from '@nestjs/common'

import { AppException } from './app.exception'

describe('AppException', () => {
  it('should create exception with all fields', () => {
    const exception = new AppException('Test error message', HttpStatus.BAD_REQUEST, 'TEST_ERROR', {
      field: 'value',
    })

    expect(exception).toBeInstanceOf(AppException)
    expect(exception).toBeInstanceOf(Error)
    expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST)

    const response = exception.getResponse() as any
    expect(response.message).toBe('Test error message')
    expect(response.errorCode).toBe('TEST_ERROR')
    expect(response.details).toEqual({ field: 'value' })
    expect(response.timestamp).toBeDefined()
    expect(typeof response.timestamp).toBe('string')
  })

  it('should work without errorCode and details', () => {
    const exception = new AppException('Simple error', HttpStatus.INTERNAL_SERVER_ERROR)

    const response = exception.getResponse() as any
    expect(response.message).toBe('Simple error')
    expect(response.errorCode).toBeUndefined()
    expect(response.details).toBeUndefined()
    expect(response.timestamp).toBeDefined()
  })

  it('should have valid ISO timestamp', () => {
    const exception = new AppException('Test', HttpStatus.BAD_REQUEST)

    const response = exception.getResponse() as any
    const timestamp = new Date(response.timestamp)

    expect(timestamp.toISOString()).toBe(response.timestamp)
    expect(timestamp.getTime()).toBeLessThanOrEqual(Date.now())
  })
})
