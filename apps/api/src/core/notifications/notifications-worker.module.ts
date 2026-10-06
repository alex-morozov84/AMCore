import { Module } from '@nestjs/common'

import { PrismaModule } from '../../prisma'

import { CHANNEL_DELIVERERS, ChannelDelivererRegistry } from './channels/channel-deliverer.registry'
import type { ChannelDeliverer } from './channels/channel-deliverer.types'
import { EmailChannelDeliverer } from './channels/email-channel.deliverer'
import { TelegramBotApiClient } from './channels/telegram/telegram-bot-api.client'
import { TelegramChannelDeliverer } from './channels/telegram/telegram-channel.deliverer'
import { NotificationAttemptAdmission } from './dispatch/notification-attempt-admission'
import { NotificationDeliveryRepository } from './dispatch/notification-delivery.repository'
import { NotificationDeliveryBacklogCollector } from './dispatch/notification-delivery-backlog.collector'
import { NotificationDispatchGate } from './dispatch/notification-dispatch.gate'
import { NotificationDispatchProcessor } from './dispatch/notification-dispatch.processor'
import { NotificationDispatchService } from './dispatch/notification-dispatch.service'
import { NotificationRecoveryService } from './dispatch/notification-recovery.service'
import { NotificationShutdownLatch } from './dispatch/notification-shutdown.latch'
import { NotificationRetentionService } from './notification-retention.service'
import { NotificationsCoreModule } from './notifications-core.module'

import { EmailModule } from '@/infrastructure/email'
import { SingletonCronRunner } from '@/infrastructure/schedule/singleton-cron.runner'

/**
 * Notifications worker slice (ADR-041 / ADR-052) — `worker`/`all` roles only. Houses the
 * durable dispatch repository, the channel deliverer registry + adapters, the dispatch
 * service, the BullMQ `@Processor`, and the recovery `@Cron`. No business controller lives
 * here; the web role never imports it, so the processor's BullMQ worker and the cron only
 * run on the worker.
 *
 * Channel deliverers register additively into `CHANNEL_DELIVERERS` (email here, Telegram in
 * Arc D). `NotificationsCoreModule` supplies the definition registry; `EmailModule` supplies
 * the `EmailService` producer. `PrismaService`/`MetricsService`/`EnvService` are global;
 * `PinoLogger` is global via the root logger module. `SingletonCronRunner` is provided
 * directly (it only needs the global `RedisLockService`) so retention coordinates without
 * depending on the auth `CleanupModule`. The recovery `@Cron` is deliberately NOT singleton-
 * locked (see `NotificationRecoveryService`); only retention uses the lock.
 */
@Module({
  imports: [PrismaModule, NotificationsCoreModule, EmailModule],
  providers: [
    // Process-wide dispatch capacity gate + shutdown latch: ONE instance shared by the BullMQ
    // wake path and the recovery cron (a per-entry instance would defeat the cap).
    NotificationShutdownLatch,
    {
      provide: NotificationDispatchGate,
      useFactory: (latch: NotificationShutdownLatch): NotificationDispatchGate =>
        new NotificationDispatchGate(latch),
      inject: [NotificationShutdownLatch],
    },
    NotificationAttemptAdmission,
    NotificationDeliveryRepository,
    NotificationDeliveryBacklogCollector,
    EmailChannelDeliverer,
    TelegramBotApiClient,
    TelegramChannelDeliverer,
    {
      provide: CHANNEL_DELIVERERS,
      useFactory: (
        email: EmailChannelDeliverer,
        telegram: TelegramChannelDeliverer
      ): ChannelDeliverer[] => [email, telegram],
      inject: [EmailChannelDeliverer, TelegramChannelDeliverer],
    },
    ChannelDelivererRegistry,
    NotificationDispatchService,
    NotificationDispatchProcessor,
    NotificationRecoveryService,
    SingletonCronRunner,
    NotificationRetentionService,
  ],
})
export class NotificationsWorkerModule {}
