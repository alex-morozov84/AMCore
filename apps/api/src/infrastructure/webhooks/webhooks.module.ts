import { Module } from '@nestjs/common'

import { GenericHmacWebhookVerifier } from './generic-hmac.webhook-verifier'
import { StripeStyleWebhookVerifier } from './stripe-style.webhook-verifier'
import { TelegramSecretTokenVerifier } from './telegram-secret-token.webhook-verifier'
import { WebhookGuard } from './webhook.guard'
import { WebhookProviderService } from './webhook-provider.service'
import { WebhookReplayService } from './webhook-replay.service'

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
