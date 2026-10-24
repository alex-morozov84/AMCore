import { Inject, Injectable, Module } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { EnvService } from '../../../../env/env.service.js'
import { type AppRedisClient, REDIS_CLIENT } from '../../../../infrastructure/redis/index.js'
import { NotificationChannelRegistry } from '../../../notifications/channels/notification-channel.registry.js'
import { telegramCheckBinding } from '../../../notifications/channels/telegram/telegram-reachability.binding.js'
import { readTelegramObservations } from '../../../notifications/channels/telegram/telegram-reachability.store.js'
import { NotificationsModule } from '../../../notifications/notifications.module.js'
import type { IntegrationReader, IntegrationReading } from '../integration.types.js'

import { aggregateTelegram } from './telegram-reachability.aggregate.js'

const NOT_CHECKED: IntegrationReading['evidence'] = {
  result: 'none',
  freshness: 'none',
  scope: 'configuration_only',
  instance: 'answering_instance',
  checkedAt: null,
  staleAfterSeconds: null,
  failure: null,
}

const READ_TIMEOUT_MS = 500
const SKEW_WARN_MS = 60_000
const SKEW_LOG_EVERY_MS = 60 * 60 * 1000

/**
 * Telegram notification channel: configuration plus what the workers stored from their `getMe`
 * check. Reads Redis only; the page never makes this server call Telegram.
 */
@Injectable()
export class TelegramIntegrationReader implements IntegrationReader {
  private skewLoggedAt = 0

  constructor(
    private readonly channels: NotificationChannelRegistry,
    private readonly env: EnvService,
    @Inject(REDIS_CLIENT) private readonly redis: AppRedisClient,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(TelegramIntegrationReader.name)
  }

  async read(): Promise<IntegrationReading> {
    let available: boolean
    try {
      available = this.channels.available('telegram')
    } catch {
      return { configuration: 'disabled', evidence: NOT_CHECKED, facts: [], links: [] }
    }
    const token = this.env.get('TELEGRAM_BOT_TOKEN')
    if (!available || !token)
      return { configuration: 'not_configured', evidence: NOT_CHECKED, facts: [], links: [] }

    const snapshot = await readTelegramObservations(this.redis, READ_TIMEOUT_MS)
    // Unknown is never ok: an unanswered read turns only this row into "Cannot read".
    if (!snapshot) throw new Error('telegram_check_unavailable')
    const apiNow = Date.now()
    this.noteSkew(apiNow - snapshot.now)
    const binding = telegramCheckBinding(token, this.env.get('TELEGRAM_API_BASE_URL'))
    const { evidence, facts } = aggregateTelegram(snapshot, binding, apiNow)
    return { configuration: 'configured', evidence, facts, links: ['runbook'] }
  }

  private noteSkew(skewMs: number): void {
    const now = Date.now()
    if (Math.abs(skewMs) <= SKEW_WARN_MS || now - this.skewLoggedAt < SKEW_LOG_EVERY_MS) return
    this.skewLoggedAt = now
    this.logger.warn({ event: 'integration_clock_skew', skewSeconds: Math.round(skewMs / 1000) })
  }
}

@Module({
  imports: [NotificationsModule],
  providers: [TelegramIntegrationReader],
  exports: [TelegramIntegrationReader],
})
export class TelegramIntegrationModule {}
