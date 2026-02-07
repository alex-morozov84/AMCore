import { ArgumentsHost, BadRequestException, HttpException, HttpStatus } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { HttpExceptionFilter } from './http-exception.filter'

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter
  let mockLogger: jest.Mocked<PinoLogger>
  let mockCls: any
  let mockResponse: any
  let mockRequest: any
  let mockHost: jest.Mocked<ArgumentsHost>

  beforeEach(() => {
    // Mock logger
    mockLogger = {
      setContext: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as any

    // Mock CLS
    mockCls = {
      getId: jest.fn().mockReturnValue('test-correlation-id'),
      get: jest.fn(),
    }

    // Mock response
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }

    // Mock request
    mockRequest = {
      url: '/api/test',
      method: 'GET',
    }

    // Mock host
    mockHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as any

    filter = new HttpExceptionFilter(mockLogger, mockCls)
  })

  it('should handle standard HttpException', () => {
    const exception = new HttpException('Not found', HttpStatus.NOT_FOUND)

    filter.catch(exception, mockHost)

    expect(mockResponse.status).toHaveBeenCalledWith(404)
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: 'Not found',
        timestamp: expect.any(String),
        path: '/api/test',
        method: 'GET',
      })
    )
  })

  it('should handle BadRequestException with validation errors (legacy array format)', () => {
    const exception = new BadRequestException([
      'email is required',
      'password must be at least 8 characters',
    ])

    filter.catch(exception, mockHost)

    expect(mockResponse.status).toHaveBeenCalledWith(400)
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'email is required', // Only first message (details lost without 'errors' field)
      })
    )
  })

  it('should handle ZodValidationException with structured errors', () => {
    // Simulate ZodValidationException response format
    const exception = new HttpException(
      {
        message: 'Validation failed',
        errors: [
          {
            code: 'invalid_type',
            path: ['email'],
            message: 'Некорректный email',
          },
          {
            code: 'too_small',
            path: ['password'],
            message: 'Минимум 8 символов',
          },
          {
            code: 'custom',
            path: ['profile', 'name'],
            message: 'Name is required',
          },
        ],
      },
      HttpStatus.BAD_REQUEST
    )

    filter.catch(exception, mockHost)

    expect(mockResponse.status).toHaveBeenCalledWith(400)
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'Validation failed',
        errors: [
          {
            field: 'email',
            message: 'Некорректный email',
            code: 'invalid_type',
          },
          {
            field: 'password',
            message: 'Минимум 8 символов',
            code: 'too_small',
          },
          {
            field: 'profile.name',
            message: 'Name is required',
            code: 'custom',
          },
        ],
      })
    )

    // Verify validation errors are logged
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        validationErrors: expect.arrayContaining([
          expect.objectContaining({
            field: 'email',
            message: 'Некорректный email',
          }),
        ]),
      }),
      expect.stringContaining('Client error')
    )
  })

  it('should extract errorCode from custom exception', () => {
    const exception = new HttpException(
      {
        message: 'User not found',
        errorCode: 'USER_NOT_FOUND',
      },
      HttpStatus.NOT_FOUND
    )

    filter.catch(exception, mockHost)

    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'USER_NOT_FOUND',
      })
    )
  })

  it('should log server errors (5xx)', () => {
    const exception = new HttpException('Internal error', HttpStatus.INTERNAL_SERVER_ERROR)

    filter.catch(exception, mockHost)

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: exception,
        req: mockRequest,
      }),
      expect.stringContaining('Server error')
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

    const exception = new HttpException('Error', HttpStatus.BAD_REQUEST)

    filter.catch(exception, mockHost)

    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        stack: expect.any(String),
      })
    )

    process.env.NODE_ENV = originalEnv
  })

  it('should not include stack trace in production', () => {
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    const exception = new HttpException('Error', HttpStatus.BAD_REQUEST)

    filter.catch(exception, mockHost)

    const jsonCall = mockResponse.json.mock.calls[0][0]
    expect(jsonCall).not.toHaveProperty('stack')

    process.env.NODE_ENV = originalEnv
  })
})
