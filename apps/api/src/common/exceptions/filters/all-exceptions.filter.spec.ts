import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { PinoLogger } from 'nestjs-pino'

import { AllExceptionsFilter } from './all-exceptions.filter'

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter
  let mockLogger: jest.Mocked<PinoLogger>
  let mockHttpAdapter: any
  let mockResponse: any
  let mockRequest: any
  let mockHost: jest.Mocked<ArgumentsHost>
  let mockHttpAdapterHost: jest.Mocked<HttpAdapterHost>

  beforeEach(() => {
    mockLogger = {
      setContext: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as any

    mockHttpAdapter = {
      reply: jest.fn(),
    }

    mockResponse = {}
    mockRequest = {
      url: '/api/test',
      method: 'POST',
      headers: { 'user-agent': 'jest' },
    }

    mockHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as any

    mockHttpAdapterHost = {
      httpAdapter: mockHttpAdapter,
    } as any

    filter = new AllExceptionsFilter(mockHttpAdapterHost, mockLogger)
  })

  it('should handle HttpException', () => {
    const exception = new HttpException('Not found', HttpStatus.NOT_FOUND)

    filter.catch(exception, mockHost)

    expect(mockHttpAdapter.reply).toHaveBeenCalledWith(
      mockResponse,
      expect.objectContaining({
        statusCode: 404,
        message: 'Not found',
        timestamp: expect.any(String),
        path: '/api/test',
        method: 'POST',
      }),
      404
    )
  })

  it('should handle standard Error as 500', () => {
    const exception = new Error('Unexpected error')

    filter.catch(exception, mockHost)

    expect(mockHttpAdapter.reply).toHaveBeenCalledWith(
      mockResponse,
      expect.objectContaining({
        statusCode: 500,
        message: 'Unexpected error',
        errorCode: 'INTERNAL_SERVER_ERROR',
      }),
      500
    )
  })

  it('should handle unknown exceptions as 500', () => {
    const exception = { weird: 'object' }

    filter.catch(exception, mockHost)

    expect(mockHttpAdapter.reply).toHaveBeenCalledWith(
      mockResponse,
      expect.objectContaining({
        statusCode: 500,
        message: 'Internal server error',
        errorCode: 'INTERNAL_SERVER_ERROR',
      }),
      500
    )
  })

  it('should handle string exceptions', () => {
    const exception = 'Something went wrong'

    filter.catch(exception, mockHost)

    expect(mockHttpAdapter.reply).toHaveBeenCalledWith(
      mockResponse,
      expect.objectContaining({
        statusCode: 500,
        message: 'Something went wrong',
      }),
      500
    )
  })

  it('should extract errorCode from HttpException', () => {
    const exception = new HttpException(
      { message: 'Conflict', errorCode: 'DUPLICATE_ENTRY' },
      HttpStatus.CONFLICT
    )

    filter.catch(exception, mockHost)

    expect(mockHttpAdapter.reply).toHaveBeenCalledWith(
      mockResponse,
      expect.objectContaining({
        errorCode: 'DUPLICATE_ENTRY',
      }),
      409
    )
  })

  it('should log server errors (5xx)', () => {
    const exception = new Error('Database connection failed')

    filter.catch(exception, mockHost)

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: exception,
        req: expect.objectContaining({
          method: 'POST',
          url: '/api/test',
        }),
      }),
      expect.stringContaining('Unhandled exception')
    )
  })

  it('should log client errors (4xx) as warnings', () => {
    const exception = new HttpException('Bad request', HttpStatus.BAD_REQUEST)

    filter.catch(exception, mockHost)

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        path: '/api/test',
      }),
      expect.stringContaining('Client error')
    )
  })

  it('should include stack trace in development', () => {
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'

    const exception = new Error('Test error')

    filter.catch(exception, mockHost)

    const replyCall = mockHttpAdapter.reply.mock.calls[0][1]
    expect(replyCall).toHaveProperty('stack')
    expect(typeof replyCall.stack).toBe('string')

    process.env.NODE_ENV = originalEnv
  })

  it('should not include stack trace in production', () => {
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    const exception = new Error('Test error')

    filter.catch(exception, mockHost)

    const replyCall = mockHttpAdapter.reply.mock.calls[0][1]
    expect(replyCall).not.toHaveProperty('stack')

    process.env.NODE_ENV = originalEnv
  })

  it('should handle validation error arrays', () => {
    const exception = new HttpException(
      { message: ['email is required', 'password too short'] },
      HttpStatus.BAD_REQUEST
    )

    filter.catch(exception, mockHost)

    expect(mockHttpAdapter.reply).toHaveBeenCalledWith(
      mockResponse,
      expect.objectContaining({
        message: 'email is required, password too short',
      }),
      400
    )
  })
})
