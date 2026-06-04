import { createHash, timingSafeEqual } from 'node:crypto'

import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common'
import type { Request } from 'express'

import { AppException } from '@/common/exceptions'
import { EnvService } from '@/env/env.service'

@Injectable()
export class MetricsAuthGuard implements CanActivate {
  constructor(private readonly env: EnvService) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.env.get('METRICS_ENABLED')) {
      return true
    }

    const expectedToken = this.env.get('METRICS_AUTH_TOKEN')
    if (!expectedToken) {
      return true
    }

    const req = context.switchToHttp().getRequest<Request>()
    const actualToken = parseBearerToken(req.headers.authorization)
    if (!actualToken || !constantTimeEquals(actualToken, expectedToken)) {
      throw new AppException(
        'Invalid metrics bearer token',
        HttpStatus.UNAUTHORIZED,
        'METRICS_AUTH_INVALID'
      )
    }

    return true
  }
}

function parseBearerToken(header: string | undefined): string | null {
  if (!header) return null
  const [scheme, token, extra] = header.split(/\s+/)
  if (extra !== undefined) return null
  if (scheme?.toLowerCase() !== 'bearer') return null
  return token || null
}

function constantTimeEquals(actual: string, expected: string): boolean {
  const actualDigest = createHash('sha256').update(actual).digest()
  const expectedDigest = createHash('sha256').update(expected).digest()
  return timingSafeEqual(actualDigest, expectedDigest)
}
