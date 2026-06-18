import { Module } from '@nestjs/common'

import { PrismaModule } from '../../prisma'

import { CHANNEL_DELIVERERS, ChannelDelivererRegistry } from './channels/channel-deliverer.registry'
import type { ChannelDeliverer } from './channels/channel-deliverer.types'
import { EmailChannelDeliverer } from './channels/email-channel.deliverer'
import { NotificationDeliveryRepository } from './dispatch/notification-delivery.repository'
import { NotificationDispatchProcessor } from './dispatch/notification-dispatch.processor'
import { NotificationDispatchService } from './dispatch/notification-dispatch.service'
import { NotificationRecoveryService } from './dispatch/notification-recovery.service'
import { NotificationsCoreModule } from './notifications-core.module'

import { EmailModule } from '@/infrastructure/email'

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
 * `PinoLogger` is global via the root logger module.
 */
@Module({
  imports: [PrismaModule, NotificationsCoreModule, EmailModule],
  providers: [
    NotificationDeliveryRepository,
    EmailChannelDeliverer,
    {
      provide: CHANNEL_DELIVERERS,
      useFactory: (email: EmailChannelDeliverer): ChannelDeliverer[] => [email],
      inject: [EmailChannelDeliverer],
    },
    ChannelDelivererRegistry,
    NotificationDispatchService,
    NotificationDispatchProcessor,
    NotificationRecoveryService,
  ],
})
export class NotificationsWorkerModule {}
