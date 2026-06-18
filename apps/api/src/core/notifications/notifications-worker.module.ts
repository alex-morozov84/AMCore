import { Module } from '@nestjs/common'

import { PrismaModule } from '../../prisma'

import { CHANNEL_DELIVERERS, ChannelDelivererRegistry } from './channels/channel-deliverer.registry'
import { NotificationDeliveryRepository } from './dispatch/notification-delivery.repository'
import { NotificationDispatchProcessor } from './dispatch/notification-dispatch.processor'
import { NotificationDispatchService } from './dispatch/notification-dispatch.service'
import { NotificationRecoveryService } from './dispatch/notification-recovery.service'

/**
 * Notifications worker slice (ADR-041 / ADR-052) — `worker`/`all` roles only. Houses the
 * durable dispatch repository, the channel deliverer registry, the dispatch service, the
 * BullMQ `@Processor`, and the recovery `@Cron`. No business controller lives here; the
 * web role never imports it, so the processor's BullMQ worker and the cron only run on the
 * worker.
 *
 * `CHANNEL_DELIVERERS` is empty here — channel adapters register additively (email in B.4,
 * Telegram in Arc D). `PrismaService` and `MetricsService` are global; `PinoLogger` is
 * global via the root logger module.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    NotificationDeliveryRepository,
    { provide: CHANNEL_DELIVERERS, useValue: [] },
    ChannelDelivererRegistry,
    NotificationDispatchService,
    NotificationDispatchProcessor,
    NotificationRecoveryService,
  ],
})
export class NotificationsWorkerModule {}
