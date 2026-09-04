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
  // Telegram's own documented update rate: bursts of up to ~30 updates/s,
  // sustained ~600/min (owner decision 3). burst: 30 is required, not
  // cosmetic — omitting it defaults to burst = rate = 600, which would let
  // 600 requests through instantly from idle (600 signature checks + body
  // parses in one burst) instead of capping the instantaneous rate at 30.
  @RateLimit({ rate: 600, per: 60_000, burst: 30 })
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handle(@Body() body: unknown): Promise<void> {
    await this.webhook.processUpdate(body)
  }
}
