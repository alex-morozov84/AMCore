import type { RawBodyRequest } from '@nestjs/common'
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'

import { VERIFY_WEBHOOK_METADATA_KEY } from './webhook.constants'
import type { WebhookProvider } from './webhook.types'
import { createWebhookException } from './webhook-errors'
import { WebhookProviderService } from './webhook-provider.service'
import { WebhookReplayService } from './webhook-replay.service'

import { EnvService } from '@/env/env.service'

@Injectable()
export class WebhookGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly env: EnvService,
    private readonly providers: WebhookProviderService,
    private readonly replay: WebhookReplayService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const provider = this.reflector.getAllAndOverride<WebhookProvider | undefined>(
      VERIFY_WEBHOOK_METADATA_KEY,
      [context.getHandler(), context.getClass()]
    )
    if (!provider) return true

    const request = context.switchToHttp().getRequest<RawBodyRequest<Request>>()
    if (!request.rawBody) throw createWebhookException('WEBHOOK_PAYLOAD_UNSUPPORTED')

    const resolved = this.providers.resolve(provider)
    if (!resolved.secret) throw createWebhookException('WEBHOOK_CONFIGURATION_MISSING')

    const result = resolved.verify({
      headers: request.headers,
      rawBody: request.rawBody,
      secret: resolved.secret,
      now: Date.now(),
      toleranceSeconds: this.env.get('WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS'),
    })
    if (!result.ok) throw createWebhookException(result.reason)

    const replayed = await this.replay.checkAndMark(
      provider,
      resolved.replayId(request.headers, request.body),
      this.env.get('WEBHOOK_REPLAY_DEDUPE_TTL_SECONDS')
    )
    if (!replayed) throw createWebhookException('WEBHOOK_REPLAY_REJECTED')

    return true
  }
}
