import { type DynamicModule, Module, type Type } from '@nestjs/common'

import { WebhooksModule } from '../../../../infrastructure/webhooks/index.js'
import { PrismaModule } from '../../../../prisma/index.js'
import { AuditModule } from '../../../audit/audit.module.js'

import { TelegramController } from './telegram.controller.js'
import { TelegramLinkService } from './telegram-link.service.js'
import { TelegramWebhookController } from './telegram-webhook.controller.js'
import { TelegramWebhookService } from './telegram-webhook.service.js'

@Module({})
export class TelegramNotificationWebModule {
  static register(core: Type<unknown>): DynamicModule {
    return {
      module: TelegramNotificationWebModule,
      imports: [PrismaModule, core, AuditModule, WebhooksModule],
      controllers: [TelegramController, TelegramWebhookController],
      providers: [TelegramLinkService, TelegramWebhookService],
    }
  }
}
