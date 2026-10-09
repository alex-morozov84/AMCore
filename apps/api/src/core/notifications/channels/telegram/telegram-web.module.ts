import { type DynamicModule, Module, type Type } from '@nestjs/common'

import { TelegramController } from './telegram.controller'
import { TelegramLinkService } from './telegram-link.service'
import { TelegramWebhookController } from './telegram-webhook.controller'
import { TelegramWebhookService } from './telegram-webhook.service'

import { AuditModule } from '@/core/audit/audit.module'
import { WebhooksModule } from '@/infrastructure/webhooks'
import { PrismaModule } from '@/prisma'

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
