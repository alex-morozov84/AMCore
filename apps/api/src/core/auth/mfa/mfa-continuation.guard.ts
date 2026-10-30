import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import type { Request } from 'express'

import { type MfaPurpose } from '@amcore/shared'

import { AppException, ForbiddenException } from '../../../common/exceptions/index.js'
import { browserSessionContext } from '../../frontend-context/browser-session-context.service.js'

import { directFlowBinding, type FlowRequest } from './mfa-flow-lock.js'

/** This capability selects one flow. It never populates request.user, abilities or ordinary session authority. */
@Injectable()
export class MfaContinuationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>()
    if (
      Object.keys(req.headers).some(
        (name) =>
          ['authorization', 'cookie', 'x-api-key'].includes(name) ||
          name.startsWith('x-invitation-')
      )
    )
      throw new ForbiddenException('Mixed continuation authority')
    if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] ?? '')))
      throw new AppException('MFA commands require JSON', 415, 'UNSUPPORTED_MEDIA_TYPE')
    if (Object.keys(req.query ?? {}).length)
      throw new AppException('Unexpected query', 400, 'VALIDATION_ERROR')
    const credential = req.headers['x-mfa-continuation']
    if (typeof credential !== 'string' || !directFlowBinding(credential))
      throw new AppException('Invalid continuation', 401, 'TOKEN_INVALID')
    const transport = browserSessionContext(req)
    if (transport && !transport.binding)
      throw new AppException('Browser context changed', 401, 'AUTH_CONTEXT_CHANGED')
    return true
  }
}

/** Called only behind the dedicated guard and strict body validation. Body identifiers grant no authority. */
export function continuationRequest(req: Request, purpose: MfaPurpose): FlowRequest {
  const credential = req.headers['x-mfa-continuation'] as string
  const browser = browserSessionContext(req)?.binding ?? null
  return {
    credential,
    purpose,
    audience: browser?.audience ?? 'direct',
    bindingHash: browser?.bindingHash ?? directFlowBinding(credential)!,
    browser,
  }
}
