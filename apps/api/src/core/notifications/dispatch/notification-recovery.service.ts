import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PinoLogger } from 'nestjs-pino'

import { NotificationDispatchService } from './notification-dispatch.service'

/**
 * Worker-only recovery poller (ADR-052). Runs on **every** worker replica — deliberately
 * NOT wrapped in `SingletonCronRunner`, which is fail-closed on a Redis lock failure
 * (exactly when recovery is needed). Mutual exclusion is the database's `FOR UPDATE SKIP
 * LOCKED` claim/reaper, not Redis. This closes the producer dual-write window: a committed
 * delivery whose best-effort wake was lost (or that came from `notifyTx`) is still drained
 * here, and an expired lease (crashed worker) is reclaimed.
 */
@Injectable()
export class NotificationRecoveryService {
  constructor(
    private readonly dispatch: NotificationDispatchService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(NotificationRecoveryService.name)
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async recover(): Promise<void> {
    try {
      await this.dispatch.runDispatchCycle()
    } catch (error) {
      // Never let a cron rejection escape; the next tick retries.
      this.logger.error(
        {
          event: 'notification.recovery_failed',
          error: error instanceof Error ? error.message : 'unknown',
        },
        'Notification recovery cycle failed'
      )
    }
  }
}
