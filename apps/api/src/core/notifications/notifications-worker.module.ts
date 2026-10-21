import { type DynamicModule, Module, type Type } from '@nestjs/common'

import { bindWorkHandlers } from '../../infrastructure/background-work/registration.js'
import { ScheduledJobsModule } from '../../infrastructure/schedule/scheduled-jobs.module.js'
import { SingletonCronRunner } from '../../infrastructure/schedule/singleton-cron.runner.js'
import { PrismaModule } from '../../prisma/index.js'

import {
  CHANNEL_DELIVERERS,
  ChannelDelivererRegistry,
} from './channels/channel-deliverer.registry.js'
import type { ChannelDeliverer } from './channels/channel-deliverer.types.js'
import type { NotificationChannelDescriptor } from './channels/notification-channel.types.js'
import { NotificationAttemptAdmission } from './dispatch/notification-attempt-admission.js'
import { NotificationDeliveryRepository } from './dispatch/notification-delivery.repository.js'
import { NotificationDeliveryBacklogCollector } from './dispatch/notification-delivery-backlog.collector.js'
import { NotificationDispatchProcessor } from './dispatch/notification-dispatch.processor.js'
import { NotificationDispatchService } from './dispatch/notification-dispatch.service.js'
import { NotificationExecutionModule } from './dispatch/notification-execution.module.js'
import { NotificationRecoveryService } from './dispatch/notification-recovery.service.js'
import { NOTIFICATION_CHANNELS } from './notification-composition.js'
import { NotificationRetentionService } from './notification-retention.service.js'
import { NotificationsModule } from './notifications.module.js'
import { notificationsWork } from './notifications.work.js'

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
        ScheduledJobsModule,
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
