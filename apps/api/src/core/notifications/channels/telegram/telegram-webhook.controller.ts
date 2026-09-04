import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiExcludeEndpoint } from '@nestjs/swagger'

import { AuthType } from '@amcore/shared'

import { Auth } from '../../../auth/decorators/auth.decorator'

import { TelegramWebhookService } from './telegram-webhook.service'

import { RateLimit } from '@/infrastructure/throttling'
import { VerifyWebhook } from '@/infrastructure/webhooks'

/**
 * Inbound Telegram webhook (Arc D / D.6). `AuthType.None` (no bearer) + `@VerifyWebhook('telegram')`
 * (constant-time secret-header check). A dedicated bounded throttle protects this public ingress
 * (not `@SkipRateLimit`); the global 100 000-byte body limit and `/webhooks/` body redaction apply.
 * Excluded from the client OpenAPI surface. Always acks **200** unless the handler signals a
 * transient/race failure (→ 5xx) so Telegram retries; a permanent reject is a durable 200 no-op.
 */
@Controller('webhooks/telegram')
export class TelegramWebhookController {
  constructor(private readonly webhook: TelegramWebhookService) {}

  @Post()
  @Auth(AuthType.None)
  @VerifyWebhook('telegram')
  // Effective ceiling is 10 req/s, not 600/min: @RateLimit only overrides the
  // `long` (per-minute) bucket — the global `short` (10 req/s) backstop is
  // never overridden and still applies. 600/min is exactly 10 req/s * 60, so
  // this `long` override can never bind before `short` does — today it's a
  // documented statement of intent, not an active ceiling. It starts doing
  // real work once the burst-tolerant limiter (planned) replaces `short`'s
  // fixed window; kept now so the call site doesn't need to change later.
  @RateLimit({ rate: 600, per: 60_000 })
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handle(@Body() body: unknown): Promise<void> {
    await this.webhook.processUpdate(body)
  }
}
