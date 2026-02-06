import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { ClsService } from 'nestjs-cls'
import { PinoLogger } from 'nestjs-pino'

interface ErrorResponse {
  statusCode: number
  message: string
  errorCode?: string
  timestamp: string
  path: string
  method: string
  correlationId?: string
  stack?: string
}

/**
 * Catch-all exception filter (last resort)
 * Handles all unhandled exceptions that other filters didn't catch
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly logger: PinoLogger,
    private readonly cls: ClsService
  ) {
    this.logger.setContext(AllExceptionsFilter.name)
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost
    const ctx = host.switchToHttp()
    const request = ctx.getRequest()
    const response = ctx.getResponse()

    // Determine status code
    const statusCode = this.getStatusCode(exception)
    const message = this.getErrorMessage(exception)
    const errorCode = this.getErrorCode(exception)

    // Build error response
    const errorResponse: ErrorResponse = {
      statusCode,
      message,
      errorCode,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      correlationId: this.cls.getId(),
    }

    // Add stack trace in development
    if (process.env.NODE_ENV === 'development' && exception instanceof Error) {
      errorResponse.stack = exception.stack
    }

    // Log error
    if (statusCode >= 500) {
      this.logger.error(
        {
          err: exception,
          req: {
            method: request.method,
            url: request.url,
            headers: request.headers,
          },
        },
        `Unhandled exception: ${message}`
      )
    } else {
      this.logger.warn({ statusCode, path: request.url }, `Client error: ${message}`)
    }

    // Send response
    httpAdapter.reply(response, errorResponse, statusCode)
  }

  /**
   * Extract HTTP status code from exception
   */
  private getStatusCode(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus()
    }
    return HttpStatus.INTERNAL_SERVER_ERROR
  }

  /**
   * Extract error message from exception
   */
  private getErrorMessage(exception: unknown): string {
    if (exception instanceof HttpException) {
      const response = exception.getResponse()
      if (typeof response === 'object' && 'message' in response) {
        const message = response.message
        return Array.isArray(message) ? message.join(', ') : String(message)
      }
      return exception.message
    }

    if (exception instanceof Error) {
      return exception.message
    }

    if (typeof exception === 'string') {
      return exception
    }

    return 'Internal server error'
  }

  /**
   * Extract error code from exception
   */
  private getErrorCode(exception: unknown): string | undefined {
    if (exception instanceof HttpException) {
      const response = exception.getResponse()
      if (typeof response === 'object' && 'errorCode' in response) {
        return String(response['errorCode'])
      }
    }

    // Default error code for unhandled exceptions
    if (this.getStatusCode(exception) >= 500) {
      return 'INTERNAL_SERVER_ERROR'
    }

    return undefined
  }
}
