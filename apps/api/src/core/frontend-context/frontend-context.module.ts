import { type CanActivate, type ExecutionContext, Global, Injectable, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import type { Request } from 'express'

import { EnvModule } from '../../env/env.module.js'

import { BrowserSessionContextService } from './browser-session-context.service.js'
import { FrontendContextService } from './frontend-context.service.js'

@Injectable()
class FrontendContextGuard implements CanActivate {
  constructor(private readonly contexts: FrontendContextService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>()
    this.contexts.verify(request, request.headers)
    return true
  }
}

@Global()
@Module({
  imports: [EnvModule],
  providers: [
    FrontendContextService,
    BrowserSessionContextService,
    { provide: APP_GUARD, useClass: FrontendContextGuard },
  ],
  exports: [FrontendContextService, BrowserSessionContextService],
})
export class FrontendContextModule {}
