import { Module } from '@nestjs/common'

import { GenericHmacWebhookVerifier } from './generic-hmac.webhook-verifier.js'
import { StripeStyleWebhookVerifier } from './stripe-style.webhook-verifier.js'
import { TelegramSecretTokenVerifier } from './telegram-secret-token.webhook-verifier.js'
import { WebhookGuard } from './webhook.guard.js'
import { WebhookProviderService } from './webhook-provider.service.js'
import { WebhookReplayService } from './webhook-replay.service.js'

@Module({
  providers: [
    GenericHmacWebhookVerifier,
    StripeStyleWebhookVerifier,
    TelegramSecretTokenVerifier,
    WebhookProviderService,
    WebhookReplayService,
    WebhookGuard,
  ],
  exports: [WebhookGuard, WebhookProviderService, WebhookReplayService],
})
export class WebhooksModule {}
