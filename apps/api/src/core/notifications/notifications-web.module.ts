import { Module } from '@nestjs/common'

import { PrismaModule } from '../../prisma'

import { NOTIFICATION_CHANNELS } from './notification-composition'
import { NotificationFeedService } from './notification-feed.service'
import { NotificationPreferenceService } from './notification-preference.service'
import { NotificationPreferencesController } from './notification-preferences.controller'
import { NotificationStreamController } from './notification-stream.controller'
import { NotificationsController } from './notifications.controller'
import { NotificationsModule } from './notifications.module'
import { NotificationRealtimeHub } from './realtime/notification-realtime.hub'
import { NotificationRealtimeSubscriber } from './realtime/notification-realtime.subscriber'

/**
 * Notifications HTTP surface (web/all only): the bearer-authenticated feed/read,
 * preferences, capabilities, and master-toggle endpoints, the realtime SSE fan-out
 * (ADR-053), and the Telegram linking surface (Arc D) — the bearer link/status/unlink
 * endpoints + the `AuthType.None` inbound webhook (`@VerifyWebhook` via `WebhooksModule`).
 * The Bot API client stays worker-only: the link confirmation is produced through
 * `notify()`, not sent here. Depends on the core module for the definition registry,
 * producer, preference repository, and realtime publisher; `AuditModule` for the bounded
 * link/unlink audit events.
 */
@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    ...NOTIFICATION_CHANNELS.flatMap((channel) =>
      channel.web ? [channel.web(NotificationsModule)] : []
    ),
  ],
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
