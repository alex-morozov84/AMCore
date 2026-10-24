import { type DynamicModule, Module, type Type } from '@nestjs/common'

import { EmailModule } from '../../../infrastructure/email/index.js'
import { ScheduledJobsModule } from '../../../infrastructure/schedule/scheduled-jobs.module.js'
import { PrismaModule } from '../../../prisma/index.js'
import { NotificationExecutionModule } from '../dispatch/notification-execution.module.js'
import { NotificationPreparedRequestService } from '../dispatch/notification-prepared-request.service.js'

import { EmailChannelDeliverer } from './email-channel.deliverer.js'
import { TelegramBotApiClient } from './telegram/telegram-bot-api.client.js'
import { TelegramChannelDeliverer } from './telegram/telegram-channel.deliverer.js'
import { TelegramReachabilityService } from './telegram/telegram-reachability.service.js'
import { TelegramReachabilityStore } from './telegram/telegram-reachability.store.js'

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
      imports: [core, PrismaModule, NotificationExecutionModule, ScheduledJobsModule],
      providers: [
        TelegramBotApiClient,
        TelegramChannelDeliverer,
        NotificationPreparedRequestService,
        // Worker-side reachability check: the process that sends is the process that is checked.
        TelegramReachabilityStore,
        TelegramReachabilityService,
      ],
      exports: [TelegramChannelDeliverer],
    }
  }
}
