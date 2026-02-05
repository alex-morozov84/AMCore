import { ArgumentsHost, HttpStatus } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'

import { PrismaClientExceptionFilter } from './prisma-exception.filter'

describe('PrismaClientExceptionFilter', () => {
  let filter: PrismaClientExceptionFilter
  let mockLogger: jest.Mocked<PinoLogger>
  let mockResponse: any
  let mockRequest: any
  let mockHost: jest.Mocked<ArgumentsHost>

  beforeEach(() => {
    mockLogger = {
      setContext: jest.fn(),
      error: jest.fn(),
    } as any

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }

    mockRequest = {
      url: '/api/users',
      method: 'POST',
    }

    mockHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as any

    filter = new PrismaClientExceptionFilter(mockLogger)
  })

  it('should map P2002 to 409 CONFLICT (unique constraint)', () => {
    const exception = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.0.0',
      meta: { target: ['email'] },
    })

    filter.catch(exception, mockHost)

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT)
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        message: 'Unique constraint violation',
        errorCode: 'PRISMA_P2002',
      })
    )
  })

  it('should map P2025 to 404 NOT_FOUND (record not found)', () => {
    const exception = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '5.0.0',
      meta: { cause: 'Record to update not found.' },
    })

    filter.catch(exception, mockHost)

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND)
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: 'Record not found',
        errorCode: 'PRISMA_P2025',
      })
    )
  })

  it('should map P2000 to 400 BAD_REQUEST (value too long)', () => {
    const exception = new Prisma.PrismaClientKnownRequestError('Value too long', {
      code: 'P2000',
      clientVersion: '5.0.0',
      meta: { column_name: 'name', constraint: 'max_length' },
    })

    filter.catch(exception, mockHost)

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST)
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'Value too long for column',
        errorCode: 'PRISMA_P2000',
      })
    )
  })

  it('should map P2003 to 400 BAD_REQUEST (foreign key constraint)', () => {
    const exception = new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
      code: 'P2003',
      clientVersion: '5.0.0',
      meta: { field_name: 'userId' },
    })

    filter.catch(exception, mockHost)

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST)
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'Foreign key constraint failed',
        errorCode: 'PRISMA_P2003',
      })
    )
  })

  it('should default to 500 for unknown Prisma error codes', () => {
    const exception = new Prisma.PrismaClientKnownRequestError('Unknown error', {
      code: 'P9999',
      clientVersion: '5.0.0',
    })

    filter.catch(exception, mockHost)

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR)
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Database error',
        errorCode: 'PRISMA_P9999',
      })
    )
  })

  it('should include Prisma metadata in development', () => {
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'

    const exception = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.0.0',
      meta: { target: ['email'], modelName: 'User' },
    })

    filter.catch(exception, mockHost)

    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: { target: ['email'], modelName: 'User' },
      })
    )

    process.env.NODE_ENV = originalEnv
  })

  it('should not include metadata in production', () => {
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    const exception = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.0.0',
      meta: { target: ['email'] },
    })

    filter.catch(exception, mockHost)

    const jsonCall = mockResponse.json.mock.calls[0][0]
    expect(jsonCall).not.toHaveProperty('details')

    process.env.NODE_ENV = originalEnv
  })

  it('should log Prisma errors with context', () => {
    const exception = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.0.0',
      meta: { target: ['email'], modelName: 'User' },
    })

    filter.catch(exception, mockHost)

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: exception,
        prismaCode: 'P2002',
        meta: { target: ['email'], modelName: 'User' },
        model: 'User',
      }),
      expect.stringContaining('Prisma error: P2002')
    )
  })
})
