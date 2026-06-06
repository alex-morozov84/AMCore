import { HttpStatus } from '@nestjs/common'

import { AppException } from '@/common/exceptions'

export function invalidIdempotencyKey(): AppException {
  return new AppException(
    'Invalid Idempotency-Key header',
    HttpStatus.BAD_REQUEST,
    'IDEMPOTENCY_KEY_INVALID'
  )
}

export function idempotencyConflict(): AppException {
  return new AppException(
    'Another request with this Idempotency-Key is in progress',
    HttpStatus.CONFLICT,
    'IDEMPOTENCY_CONFLICT'
  )
}

export function idempotencyKeyReuse(): AppException {
  return new AppException(
    'Idempotency-Key was reused with a different request payload',
    HttpStatus.UNPROCESSABLE_ENTITY,
    'IDEMPOTENCY_KEY_REUSE'
  )
}

export function idempotencyUnavailable(): AppException {
  return new AppException(
    'Idempotency service is unavailable',
    HttpStatus.SERVICE_UNAVAILABLE,
    'IDEMPOTENCY_UNAVAILABLE'
  )
}
