import { type DynamicModule, Module, type Type } from '@nestjs/common'

import { NotificationExecutionModule } from '../dispatch/notification-execution.module'
import { NotificationPreparedRequestService } from '../dispatch/notification-prepared-request.service'

import { EmailChannelDeliverer } from './email-channel.deliverer'
import { TelegramBotApiClient } from './telegram/telegram-bot-api.client'
import { TelegramChannelDeliverer } from './telegram/telegram-channel.deliverer'

import { EmailModule } from '@/infrastructure/email'
import { PrismaModule } from '@/prisma'

@Module({})
export class EmailNotificationDeliveryModule {
  static register(core: Type<unknown>): DynamicModule {
    return {
      module: EmailNotificationDeliveryModule,
      imports: [core, EmailModule, PrismaModule, NotificationExecutionModule],
      providers: [EmailChannelDeliverer, NotificationPreparedRequestService],
      exports: [EmailChannelDeliverer],
    }
  }
}

@Module({})
export class TelegramNotificationDeliveryModule {
  static register(core: Type<unknown>): DynamicModule {
    return {
      module: TelegramNotificationDeliveryModule,
      imports: [core, PrismaModule, NotificationExecutionModule],
      providers: [
        TelegramBotApiClient,
        TelegramChannelDeliverer,
        NotificationPreparedRequestService,
      ],
      exports: [TelegramChannelDeliverer],
    }
  }
}
