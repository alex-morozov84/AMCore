import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Response } from 'express'
import { ClsService } from 'nestjs-cls'
import { PinoLogger } from 'nestjs-pino'

import type { ErrorResponse } from '../types'

interface PrismaErrorMapping {
  status: HttpStatus
  message: string
}

type PrismaClientException =
  | Prisma.PrismaClientKnownRequestError
  | Prisma.PrismaClientUnknownRequestError
  | Prisma.PrismaClientInitializationError
  | Prisma.PrismaClientRustPanicError
  | Prisma.PrismaClientValidationError

/**
 * Filter for handling Prisma Client errors
 * Maps Prisma error codes to appropriate HTTP status codes
 */
@Catch(
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientUnknownRequestError,
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientRustPanicError,
  Prisma.PrismaClientValidationError
)
export class PrismaClientExceptionFilter implements ExceptionFilter {
  private readonly errorCodeMapping: Record<string, PrismaErrorMapping> = {
    P2000: {
      status: HttpStatus.BAD_REQUEST,
      message: 'Value too long for column',
    },
    P2001: {
      status: HttpStatus.NOT_FOUND,
      message: 'Record does not exist',
    },
    P2002: {
      status: HttpStatus.CONFLICT,
      message: 'Unique constraint violation',
    },
    P2003: {
      status: HttpStatus.BAD_REQUEST,
      message: 'Foreign key constraint failed',
    },
    P2011: {
      status: HttpStatus.BAD_REQUEST,
      message: 'Null constraint violation',
    },
    P2014: {
      status: HttpStatus.BAD_REQUEST,
      message: 'Invalid relation',
    },
    P2020: {
      status: HttpStatus.BAD_REQUEST,
      message: 'Value out of range for type',
    },
    P2025: {
      status: HttpStatus.NOT_FOUND,
      message: 'Record not found',
    },
    P2034: {
      status: HttpStatus.CONFLICT,
      message: 'Transaction conflict or deadlock, please retry',
    },
  }

  constructor(
    private readonly logger: PinoLogger,
    private readonly cls: ClsService
  ) {
    this.logger.setContext(PrismaClientExceptionFilter.name)
  }

  catch(exception: PrismaClientException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest()

    const { errorCode, statusCode, message, details, logContext } =
      this.buildExceptionContext(exception)

    const errorResponse: ErrorResponse = {
      statusCode,
      message,
      errorCode,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      correlationId: this.cls.getId(),
    }

    if (details) {
      errorResponse.details = details
    }

    this.logger.error(logContext, `Prisma error: ${errorCode} - ${message}`)

    response.status(statusCode).json(errorResponse)
  }

  private buildExceptionContext(exception: PrismaClientException): {
    errorCode: string
    statusCode: HttpStatus
    message: string
    details?: Record<string, unknown>
    logContext: Record<string, unknown>
  } {
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapping = this.errorCodeMapping[exception.code]
      return {
        errorCode: `PRISMA_${exception.code}`,
        statusCode: mapping?.status ?? HttpStatus.INTERNAL_SERVER_ERROR,
        message: mapping?.message ?? 'Database error',
        ...(process.env.NODE_ENV === 'development' && exception.meta
          ? { details: exception.meta as Record<string, unknown> }
          : {}),
        logContext: {
          err: exception,
          prismaCode: exception.code,
          meta: exception.meta,
          model: exception.meta?.['modelName'],
        },
      }
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        errorCode: 'PRISMA_VALIDATION_ERROR',
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid database query',
        logContext: {
          err: exception,
          prismaType: exception.name,
        },
      }
    }

    if (exception instanceof Prisma.PrismaClientInitializationError) {
      return {
        errorCode: 'PRISMA_INITIALIZATION_ERROR',
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Database temporarily unavailable',
        ...(process.env.NODE_ENV === 'development'
          ? {
              details: {
                prismaType: exception.name,
                ...(exception.errorCode ? { errorCode: exception.errorCode } : {}),
              },
            }
          : {}),
        logContext: {
          err: exception,
          prismaType: exception.name,
          prismaCode: exception.errorCode,
        },
      }
    }

    if (exception instanceof Prisma.PrismaClientUnknownRequestError) {
      return {
        errorCode: 'PRISMA_UNKNOWN_REQUEST_ERROR',
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Database temporarily unavailable',
        logContext: {
          err: exception,
          prismaType: exception.name,
        },
      }
    }

    return {
      errorCode: 'PRISMA_ENGINE_ERROR',
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Database engine error',
      logContext: {
        err: exception,
        prismaType: exception.name,
      },
    }
  }
}
