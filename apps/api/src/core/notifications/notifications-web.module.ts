import { Module } from '@nestjs/common'

import { PrismaModule } from '../../prisma'

import { NotificationFeedService } from './notification-feed.service'
import { NotificationPreferenceService } from './notification-preference.service'
import { NotificationPreferencesController } from './notification-preferences.controller'
import { NotificationsController } from './notifications.controller'
import { NotificationsCoreModule } from './notifications-core.module'

/**
 * Notifications HTTP surface (web/all only): the bearer-authenticated feed/read,
 * preferences, capabilities, and master-toggle endpoints. Depends on the core module
 * for the definition registry and preference repository. No processor/cron/realtime
 * here (Arc B/C).
 */
@Module({
  imports: [PrismaModule, NotificationsCoreModule],
  controllers: [NotificationsController, NotificationPreferencesController],
  providers: [NotificationFeedService, NotificationPreferenceService],
})
export class NotificationsWebModule {}
