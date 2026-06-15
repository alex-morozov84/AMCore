import { Module } from '@nestjs/common'

import { PrismaModule } from '../../prisma'

import { NotificationDefinitionRegistry } from './notification-definition.registry'
import { NotificationPreferenceRepository } from './notification-preference.repository'
import { NotificationPreferenceResolver } from './notification-preference.resolver'
import { NotificationsService } from './notifications.service'

/**
 * Notifications core (ADR-052): the definition registry, preference resolver/repo,
 * and the `NotificationsService` producer. No controller, processor, cron, or
 * realtime — those belong to the web/worker modules (Arc B+). Imported by every
 * process role via `coreImports()`.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    NotificationDefinitionRegistry,
    NotificationPreferenceResolver,
    NotificationPreferenceRepository,
    NotificationsService,
  ],
  exports: [NotificationsService, NotificationDefinitionRegistry, NotificationPreferenceRepository],
})
export class NotificationsCoreModule {}
