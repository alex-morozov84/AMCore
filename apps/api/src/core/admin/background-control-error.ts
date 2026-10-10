import { HttpStatus } from '@nestjs/common'

import type { WorkReason } from '@amcore/shared'

import { AppException } from '@/common/exceptions'

/** Closed operator codes; no provider, Redis or database error text in the response. */
export function backgroundControlError(reason: WorkReason, retryAfterMs?: number): AppException {
  const status =
    reason === 'RATE_LIMIT_EXCEEDED'
      ? HttpStatus.TOO_MANY_REQUESTS
      : reason === 'WORK_UNAVAILABLE'
        ? HttpStatus.SERVICE_UNAVAILABLE
        : HttpStatus.CONFLICT
  const details =
    reason === 'RATE_LIMIT_EXCEEDED' &&
    retryAfterMs !== undefined &&
    Number.isSafeInteger(retryAfterMs) &&
    retryAfterMs > 0 &&
    retryAfterMs <= 86400000
      ? { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) }
      : undefined
  return new AppException('Background work action unavailable', status, reason, details)
}
