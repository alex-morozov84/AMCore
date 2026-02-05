import { HttpException, HttpStatus } from '@nestjs/common'

/**
 * Base application exception class
 * All custom domain exceptions should extend this class
 */
export class AppException extends HttpException {
  constructor(
    message: string,
    statusCode: HttpStatus,
    readonly errorCode?: string,
    readonly details?: Record<string, unknown>
  ) {
    super(
      {
        message,
        errorCode,
        details,
        timestamp: new Date().toISOString(),
      },
      statusCode
    )
  }
}
