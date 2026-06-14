import { HttpStatus } from '@nestjs/common'

import { AppException } from './app.exception'

/**
 * Request body exceeded the configured parser limit (413).
 *
 * Raised by `AllExceptionsFilter` when body-parser reports `entity.too.large`,
 * so an oversized JSON or urlencoded body surfaces as a stable 413 with the
 * machine-readable `PAYLOAD_TOO_LARGE` code instead of a generic 500. Multipart
 * uploads use `FILE_TOO_LARGE` from the file-validation pipe; this code is for
 * the global body-parser limit.
 */
export class PayloadTooLargeException extends AppException {
  constructor(message = 'Request body too large', details?: Record<string, unknown>) {
    super(message, HttpStatus.PAYLOAD_TOO_LARGE, 'PAYLOAD_TOO_LARGE', details)
  }
}
