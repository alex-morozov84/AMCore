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

/**
 * Filter for handling Prisma Client errors
 * Maps Prisma error codes to appropriate HTTP status codes
 */
@Catch(Prisma.PrismaClientKnownRequestError)
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

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest()

    // Get mapping or default to 500
    const mapping = this.errorCodeMapping[exception.code]
    const statusCode = mapping?.status ?? HttpStatus.INTERNAL_SERVER_ERROR
    const message = mapping?.message ?? 'Database error'

    // Build error response
    const errorResponse: ErrorResponse = {
      statusCode,
      message,
      errorCode: `PRISMA_${exception.code}`,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      correlationId: this.cls.getId(),
    }

    // Add Prisma metadata in development
    if (process.env.NODE_ENV === 'development' && exception.meta) {
      errorResponse.details = exception.meta as Record<string, unknown>
    }

    // Log error with context
    this.logger.error(
      {
        err: exception,
        prismaCode: exception.code,
        meta: exception.meta,
        model: exception.meta?.['modelName'],
      },
      `Prisma error: ${exception.code} - ${message}`
    )

    response.status(statusCode).json(errorResponse)
  }
}
