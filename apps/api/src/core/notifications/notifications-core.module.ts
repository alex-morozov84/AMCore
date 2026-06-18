import { Module } from '@nestjs/common'

import { PrismaModule } from '../../prisma'

import { ChannelTargetResolverRegistry } from './channels/channel-target-resolver.registry'
import { NotificationDefinitionRegistry } from './notification-definition.registry'
import { NotificationPreferenceRepository } from './notification-preference.repository'
import { NotificationPreferenceResolver } from './notification-preference.resolver'
import { NotificationsService } from './notifications.service'

import { QueueModule } from '@/infrastructure/queue'

/**
 * Notifications core (ADR-052): the definition registry, preference resolver/repo,
 * produce-time channel target resolvers, and the `NotificationsService` producer. No
 * controller, processor, cron, or realtime — those belong to the web/worker modules.
 * Imported by every process role via `coreImports()`. `QueueModule` supplies the
 * `QueueService` the producer uses to best-effort wake the dispatcher.
 */
@Module({
  imports: [PrismaModule, QueueModule],
  providers: [
    // Default-construct via factory: the registry's `definitions` constructor param
    // is an Array, which has no DI token — Nest would fail to resolve it. The
    // factory keeps the shipped `NOTIFICATION_DEFINITIONS` as the implicit default
    // while leaving tests free to construct with a custom set directly (`new
    // NotificationDefinitionRegistry([...])`).
    {
      provide: NotificationDefinitionRegistry,
      useFactory: (): NotificationDefinitionRegistry => new NotificationDefinitionRegistry(),
    },
    // Same factory pattern: the resolver-array constructor param has no DI token.
    {
      provide: ChannelTargetResolverRegistry,
      useFactory: (): ChannelTargetResolverRegistry => new ChannelTargetResolverRegistry(),
    },
    NotificationPreferenceResolver,
    NotificationPreferenceRepository,
    NotificationsService,
  ],
  exports: [NotificationsService, NotificationDefinitionRegistry, NotificationPreferenceRepository],
})
export class NotificationsCoreModule {}
