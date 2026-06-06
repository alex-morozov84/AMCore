import type { Request } from 'express'

import { IDEMPOTENCY_HEADER } from './idempotency.constants'

const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9:_-]{1,255}$/

export function parseIdempotencyKey(req: Request): string | null {
  const value = req.headers[IDEMPOTENCY_HEADER.toLowerCase()]
  if (Array.isArray(value) || typeof value !== 'string') return null
  return IDEMPOTENCY_KEY_REGEX.test(value) ? value : null
}
