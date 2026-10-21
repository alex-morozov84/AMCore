import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { cycleOutcome } from '../../../infrastructure/schedule/dispatch-cycle.js'
import {
  errorCode,
  ScheduledJobExecutor,
} from '../../../infrastructure/schedule/scheduled-job.executor.js'
import { failed, ScheduledJob } from '../../../infrastructure/schedule/scheduled-job.js'
import { NOTIFICATION_RECOVERY_JOB } from '../../../infrastructure/schedule/scheduled-jobs.catalogue.js'

import { NotificationDispatchService } from './notification-dispatch.service.js'

/**
 * Worker-only recovery poller (ADR-052). Runs on **every** worker replica — deliberately
 * NOT wrapped in `SingletonCronRunner`, which is fail-closed on a Redis lock failure
 * (exactly when recovery is needed). Mutual exclusion is the database's `FOR UPDATE SKIP
 * LOCKED` claim/reaper, not Redis. This closes the producer dual-write window: a committed
 * delivery whose best-effort wake was lost (or that came from `notifyTx`) is still drained
 * here, and an expired lease (crashed worker) is reclaimed.
 *
 * Its recorded result describes the recovery pass, not any delivery: `success` is a pass that
 * ran to the end, `skipped(busy)` a pass whose lanes were all taken.
 */
@Injectable()
export class NotificationRecoveryService {
  constructor(
    private readonly dispatch: NotificationDispatchService,
    private readonly jobs: ScheduledJobExecutor,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(NotificationRecoveryService.name)
  }

  @ScheduledJob(NOTIFICATION_RECOVERY_JOB)
  async recover(): Promise<void> {
    await this.jobs.run(NOTIFICATION_RECOVERY_JOB, async () => {
      try {
        return cycleOutcome(await this.dispatch.runDispatchCycle())
      } catch (error) {
        // Never let a cron rejection escape; the next tick retries.
        this.logger.error(
          {
            event: 'notification.recovery_failed',
            error: error instanceof Error ? error.message : 'unknown',
          },
          'Notification recovery cycle failed'
        )
        return failed(errorCode(error))
      }
    })
  }
}
