import { Injectable, Module } from '@nestjs/common'

import { NotificationChannelRegistry } from '../../../notifications/channels/notification-channel.registry.js'
import { NotificationsModule } from '../../../notifications/notifications.module.js'
import type { IntegrationReader, IntegrationReading } from '../integration.types.js'

/** Telegram notification channel: configuration only. Reachability from this server is not checked here. */
@Injectable()
export class TelegramIntegrationReader implements IntegrationReader {
  constructor(private readonly channels: NotificationChannelRegistry) {}

  read(): Promise<IntegrationReading> {
    let registered = true
    let available = false
    try {
      available = this.channels.available('telegram')
    } catch {
      registered = false
    }
    return Promise.resolve({
      configuration: !registered ? 'disabled' : available ? 'configured' : 'not_configured',
      evidence: {
        result: 'none',
        freshness: 'none',
        scope: 'configuration_only',
        instance: 'answering_instance',
        checkedAt: null,
        staleAfterSeconds: null,
        failure: null,
      },
      facts: [],
      links: [],
    })
  }
}

@Module({
  imports: [NotificationsModule],
  providers: [TelegramIntegrationReader],
  exports: [TelegramIntegrationReader],
})
export class TelegramIntegrationModule {}
