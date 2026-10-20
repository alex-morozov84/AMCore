import { timingSafeEqual } from 'node:crypto'

import { Injectable, type OnModuleInit } from '@nestjs/common'

import { WEB_FRONTEND_HEADERS } from '@amcore/shared'

import { ForbiddenException, ServiceUnavailableException } from '../../common/exceptions/index.js'
import { EnvService } from '../../env/env.service.js'

import { type BrowserFrontendContext, resolveFrontendPlacement } from './frontend-placement.js'

const verifiedContexts = new WeakMap<object, BrowserFrontendContext>()

export function browserFrontendContext(request?: object): BrowserFrontendContext | undefined {
  return request ? verifiedContexts.get(request) : undefined
}

@Injectable()
export class FrontendContextService implements OnModuleInit {
  constructor(private readonly env: EnvService) {}

  onModuleInit(): void {
    resolveFrontendPlacement(this.env)
  }

  verify(request: object, headers: Record<string, string | string[] | undefined>): void {
    const frontend = headers[WEB_FRONTEND_HEADERS.frontend]
    const fingerprint = headers[WEB_FRONTEND_HEADERS.placement]
    const key = headers[WEB_FRONTEND_HEADERS.key]
    if (frontend === undefined && fingerprint === undefined && key === undefined) return
    const expectedKey = this.env.get('WEB_FRONTEND_CONTEXT_KEY')
    if (
      (frontend !== 'site' && frontend !== 'admin') ||
      typeof fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(fingerprint) ||
      typeof key !== 'string' ||
      !expectedKey ||
      Buffer.byteLength(key) !== Buffer.byteLength(expectedKey) ||
      !timingSafeEqual(Buffer.from(key), Buffer.from(expectedKey))
    )
      throw new ForbiddenException('Invalid frontend context')
    const placement = resolveFrontendPlacement(this.env)
    if (fingerprint !== placement.placementFingerprint)
      throw new ServiceUnavailableException('Frontend configuration unavailable')
    verifiedContexts.set(request, Object.freeze({ frontend, placementFingerprint: fingerprint }))
  }
}
