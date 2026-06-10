import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common'
import type { Request } from 'express'

import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../../common/exceptions'
import { EnvService } from '../../../env/env.service'

@Injectable()
export class OriginCheckGuard implements CanActivate {
  constructor(private readonly env: EnvService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>()
    const origin = this.resolveOrigin(request)

    if (origin === null) return true
    if (this.env.get('CORS_ORIGIN').includes(origin)) return true

    throw new AppException(
      'Request origin rejected',
      HttpStatus.FORBIDDEN,
      AuthErrorCode.AUTH_ORIGIN_REJECTED
    )
  }

  private resolveOrigin(request: Request): string | null {
    const originHeader = this.readHeader(request, 'origin')
    if (originHeader !== null) {
      return this.parseOrigin(originHeader)
    }

    const refererHeader = this.readHeader(request, 'referer')
    if (refererHeader === null) return null

    return this.parseOrigin(refererHeader)
  }

  private parseOrigin(value: string): string {
    try {
      return new URL(value).origin
    } catch {
      throw new AppException(
        'Request origin rejected',
        HttpStatus.FORBIDDEN,
        AuthErrorCode.AUTH_ORIGIN_REJECTED
      )
    }
  }

  private readHeader(request: Request, name: 'origin' | 'referer'): string | null {
    const value = request.headers[name]
    return typeof value === 'string' && value.length > 0 ? value : null
  }
}
