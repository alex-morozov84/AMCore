import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common'
import { Response } from 'express'
import { PinoLogger } from 'nestjs-pino'

interface ErrorResponse {
  statusCode: number
  message: string
  errorCode?: string
  timestamp: string
  path: string
  method: string
  stack?: string
}

/**
 * Filter for handling standard NestJS HttpException
 * Catches: BadRequestException, UnauthorizedException, NotFoundException, etc.
 */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(HttpExceptionFilter.name)
  }

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest()

    const statusCode = exception.getStatus()
    const exceptionResponse = exception.getResponse()

    // Extract message and errorCode from response
    const message = this.extractMessage(exceptionResponse)
    const errorCode = this.extractErrorCode(exceptionResponse)

    // Build error response
    const errorResponse: ErrorResponse = {
      statusCode,
      message,
      errorCode,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
    }

    // Add stack trace in development
    if (process.env.NODE_ENV === 'development') {
      errorResponse.stack = exception.stack
    }

    // Log based on status code
    if (statusCode >= 500) {
      this.logger.error({ err: exception, req: request }, `Server error: ${message}`)
    } else if (statusCode >= 400) {
      this.logger.warn({ statusCode, path: request.url }, `Client error: ${message}`)
    }

    response.status(statusCode).json(errorResponse)
  }

  /**
   * Extract error message from exception response
   */
  private extractMessage(exceptionResponse: string | object): string {
    if (typeof exceptionResponse === 'string') {
      return exceptionResponse
    }

    if (typeof exceptionResponse === 'object' && 'message' in exceptionResponse) {
      const message = exceptionResponse.message
      // Handle array of messages (validation errors)
      if (Array.isArray(message)) {
        return message.join(', ')
      }
      return String(message)
    }

    return 'An error occurred'
  }

  /**
   * Extract error code from exception response
   */
  private extractErrorCode(exceptionResponse: string | object): string | undefined {
    if (typeof exceptionResponse === 'object' && 'errorCode' in exceptionResponse) {
      return String(exceptionResponse['errorCode'])
    }
    return undefined
  }
}
