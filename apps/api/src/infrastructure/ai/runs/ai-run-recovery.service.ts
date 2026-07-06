import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PinoLogger } from 'nestjs-pino'

import { AiRunDispatchService } from './ai-run-dispatch.service'

/**
 * Worker-only AI run recovery poller (Track C — ADR-054, ADR-052 pattern). Runs on **every** worker
 * replica — deliberately NOT wrapped in `SingletonCronRunner`, which is fail-closed on a Redis lock
 * failure (exactly when recovery is needed). Mutual exclusion is the database's `FOR UPDATE SKIP
 * LOCKED` claim/reaper, not Redis. It closes the producer's dual-write window (a committed `QUEUED`
 * run whose best-effort wake was lost is still drained here) and reclaims expired leases from
 * crashed workers — the at-least-once safety net behind the wake path.
 */
@Injectable()
export class AiRunRecoveryService {
  constructor(
    private readonly dispatch: AiRunDispatchService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiRunRecoveryService.name)
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async recover(): Promise<void> {
    try {
      await this.dispatch.runDispatchCycle()
    } catch (error) {
      // Never let a cron rejection escape; the next tick retries.
      this.logger.error(
        {
          event: 'ai.run.recovery_failed',
          error: error instanceof Error ? error.message : 'unknown',
        },
        'AI run recovery cycle failed'
      )
    }
  }
}
