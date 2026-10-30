import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import type { Request } from 'express'

import { AppException, ForbiddenException } from '../../../common/exceptions/index.js'
import {
  browserSessionContext,
  BrowserSessionContextService,
} from '../../frontend-context/browser-session-context.service.js'

/** Dedicated private credential family: no ordinary bearer, cookie, API key or continuation fallback. */
@Injectable()
export class BrowserPublicationGuard implements CanActivate {
  constructor(private readonly contexts: BrowserSessionContextService) {}

  canActivate(execution: ExecutionContext): boolean {
    const req = execution.switchToHttp().getRequest<Request>()
    const mixed = Object.keys(req.headers).some(
      (name) =>
        ['authorization', 'cookie', 'x-api-key'].includes(name) ||
        name.startsWith('x-invitation-') ||
        name.startsWith('x-mfa-') ||
        name.startsWith('x-amcore-mfa-')
    )
    if (mixed) throw new ForbiddenException('Mixed browser credential authority')
    if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] ?? '')))
      throw new AppException(
        'Browser credential requests require JSON',
        415,
        'UNSUPPORTED_MEDIA_TYPE'
      )
    if (Object.keys(req.query ?? {}).length)
      throw new AppException('Unexpected query', 400, 'VALIDATION_ERROR')
    this.contexts.verify(req, req.headers)
    if (!browserSessionContext(req))
      throw new ForbiddenException('Private browser transport required')
    return true
  }
}
