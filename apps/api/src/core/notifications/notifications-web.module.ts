import { Module } from '@nestjs/common'

import { PrismaModule } from '../../prisma'

import { NotificationFeedService } from './notification-feed.service'
import { NotificationPreferenceService } from './notification-preference.service'
import { NotificationPreferencesController } from './notification-preferences.controller'
import { NotificationStreamController } from './notification-stream.controller'
import { NotificationsController } from './notifications.controller'
import { NotificationsCoreModule } from './notifications-core.module'
import { NotificationRealtimeHub } from './realtime/notification-realtime.hub'
import { NotificationRealtimeSubscriber } from './realtime/notification-realtime.subscriber'

/**
 * Notifications HTTP surface (web/all only): the bearer-authenticated feed/read,
 * preferences, capabilities, and master-toggle endpoints, plus the realtime SSE
 * fan-out (ADR-053) — the process-local `NotificationRealtimeHub` and the dedicated
 * Redis Pub/Sub `NotificationRealtimeSubscriber` live here, not on the worker, so a
 * stream and its subscriber only run in the web role. Depends on the core module for
 * the definition registry, preference repository, and realtime publisher.
 */
@Module({
  imports: [PrismaModule, NotificationsCoreModule],
  controllers: [
    NotificationsController,
    NotificationPreferencesController,
    NotificationStreamController,
  ],
  providers: [
    NotificationFeedService,
    NotificationPreferenceService,
    NotificationRealtimeHub,
    NotificationRealtimeSubscriber,
  ],
})
export class NotificationsWebModule {}
