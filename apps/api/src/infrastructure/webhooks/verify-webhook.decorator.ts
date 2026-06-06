import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common'

import { VERIFY_WEBHOOK_METADATA_KEY } from './webhook.constants'
import { WebhookGuard } from './webhook.guard'
import type { WebhookProvider } from './webhook.types'

export const VerifyWebhook = (provider: WebhookProvider): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(VERIFY_WEBHOOK_METADATA_KEY, provider), UseGuards(WebhookGuard))
