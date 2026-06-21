import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiExcludeEndpoint } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'

import { AuthType } from '@amcore/shared'

import { Auth } from '../../../auth/decorators/auth.decorator'

import { TelegramWebhookService } from './telegram-webhook.service'

import { VerifyWebhook } from '@/infrastructure/webhooks'

/**
 * Inbound Telegram webhook (Arc D / D.6). `AuthType.None` (no bearer) + `@VerifyWebhook('telegram')`
 * (constant-time secret-header check). A dedicated bounded throttle protects this public ingress
 * (not `@SkipThrottle`); the global 100 000-byte body limit and `/webhooks/` body redaction apply.
 * Excluded from the client OpenAPI surface. Always acks **200** unless the handler signals a
 * transient/race failure (→ 5xx) so Telegram retries; a permanent reject is a durable 200 no-op.
 */
@Controller('webhooks/telegram')
export class TelegramWebhookController {
  constructor(private readonly webhook: TelegramWebhookService) {}

  @Post()
  @Auth(AuthType.None)
  @VerifyWebhook('telegram')
  @Throttle({ short: { limit: 30, ttl: 1000 }, long: { limit: 600, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handle(@Body() body: unknown): Promise<void> {
    await this.webhook.processUpdate(body)
  }
}
