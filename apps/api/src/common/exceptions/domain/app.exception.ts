import { HttpException, HttpStatus } from '@nestjs/common'

/**
 * Base application exception class
 * All custom domain exceptions should extend this class
 */
export class AppException extends HttpException {
  constructor(
    message: string,
    statusCode: HttpStatus,
    public readonly errorCode?: string,
    public readonly details?: Record<string, any>
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
