import { Module } from '@nestjs/common'

import { PrismaModule } from '../../prisma'

import { NotificationFeedService } from './notification-feed.service'
import { NotificationsController } from './notifications.controller'
import { NotificationsCoreModule } from './notifications-core.module'

/**
 * Notifications HTTP surface (web/all only): the bearer-authenticated feed/read
 * endpoints. Depends on the core module for the definition registry (used to render
 * feed content). No processor/cron/realtime here (Arc B/C).
 */
@Module({
  imports: [PrismaModule, NotificationsCoreModule],
  controllers: [NotificationsController],
  providers: [NotificationFeedService],
})
export class NotificationsWebModule {}
