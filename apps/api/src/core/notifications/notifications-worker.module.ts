import { type DynamicModule, Module, type Type } from '@nestjs/common'

import { PrismaModule } from '../../prisma'

import { CHANNEL_DELIVERERS, ChannelDelivererRegistry } from './channels/channel-deliverer.registry'
import type { ChannelDeliverer } from './channels/channel-deliverer.types'
import type { NotificationChannelDescriptor } from './channels/notification-channel.types'
import { NotificationAttemptAdmission } from './dispatch/notification-attempt-admission'
import { NotificationDeliveryRepository } from './dispatch/notification-delivery.repository'
import { NotificationDeliveryBacklogCollector } from './dispatch/notification-delivery-backlog.collector'
import { NotificationDispatchProcessor } from './dispatch/notification-dispatch.processor'
import { NotificationDispatchService } from './dispatch/notification-dispatch.service'
import { NotificationExecutionModule } from './dispatch/notification-execution.module'
import { NotificationRecoveryService } from './dispatch/notification-recovery.service'
import { NOTIFICATION_CHANNELS } from './notification-composition'
import { NotificationRetentionService } from './notification-retention.service'
import { NotificationsModule } from './notifications.module'
import { notificationsWork } from './notifications.work'

import { bindWorkHandlers } from '@/infrastructure/background-work/registration'
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
@Module({})
export class ConfiguredNotificationsWorkerModule {
  static register(
    core: Type<unknown>,
    channels: readonly NotificationChannelDescriptor[]
  ): DynamicModule {
    return {
      module: ConfiguredNotificationsWorkerModule,
      imports: [
        PrismaModule,
        core,
        NotificationExecutionModule,
        ...channels.map((channel) => channel.worker(core)),
      ],
      providers: [
        NotificationAttemptAdmission,
        NotificationDeliveryRepository,
        NotificationDeliveryBacklogCollector,
        {
          provide: CHANNEL_DELIVERERS,
          useFactory: (...deliverers: ChannelDeliverer[]) => {
            for (const [index, deliverer] of deliverers.entries()) {
              if (deliverer.channel !== channels[index]?.id)
                throw new Error('Channel deliverer token mismatch')
            }
            return deliverers
          },
          inject: channels.map((channel) => channel.delivererToken),
        },
        ChannelDelivererRegistry,
        NotificationDispatchService,
        NotificationDispatchProcessor,
        NotificationRecoveryService,
        SingletonCronRunner,
        NotificationRetentionService,
      ],
      exports: [NotificationDispatchProcessor],
    }
  }
}

const configuredWorker = ConfiguredNotificationsWorkerModule.register(
  NotificationsModule,
  NOTIFICATION_CHANNELS
)
const bindings = bindWorkHandlers(
  notificationsWork,
  { 'dispatch-due@1': NotificationDispatchProcessor },
  [configuredWorker]
)
@Module({ imports: [configuredWorker, bindings], exports: [bindings] })
export class NotificationsWorkerModule {}
