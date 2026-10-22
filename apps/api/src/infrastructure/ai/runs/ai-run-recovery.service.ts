import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { cycleOutcome } from '../../schedule/dispatch-cycle.js'
import { errorCode, ScheduledJobExecutor } from '../../schedule/scheduled-job.executor.js'
import { failed, ScheduledJob } from '../../schedule/scheduled-job.js'
import { AI_RUN_RECOVERY_JOB } from '../../schedule/scheduled-jobs.catalogue.js'

import { AiRunDispatchService } from './ai-run-dispatch.service.js'

/**
 * Worker-only AI run recovery poller (Track C — ADR-054, ADR-052 pattern). Runs on **every** worker
 * replica — deliberately NOT wrapped in `SingletonCronRunner`, which is fail-closed on a Redis lock
 * failure (exactly when recovery is needed). Mutual exclusion is the database's `FOR UPDATE SKIP
 * LOCKED` claim/reaper, not Redis. It closes the producer's dual-write window (a committed `QUEUED`
 * run whose best-effort wake was lost is still drained here) and reclaims expired leases from
 * crashed workers — the at-least-once safety net behind the wake path.
 *
 * Its recorded result describes the recovery pass, not any run: `success` is a pass that ran to
 * the end, `skipped(busy)` a pass whose lanes were all taken.
 */
@Injectable()
export class AiRunRecoveryService {
  constructor(
    private readonly dispatch: AiRunDispatchService,
    private readonly jobs: ScheduledJobExecutor,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiRunRecoveryService.name)
  }

  @ScheduledJob(AI_RUN_RECOVERY_JOB)
  async recover(): Promise<void> {
    await this.jobs.run(AI_RUN_RECOVERY_JOB, async () => {
      try {
        return cycleOutcome(await this.dispatch.runDispatchCycle())
      } catch (error) {
        // Never let a cron rejection escape; the next tick retries.
        this.logger.error(
          {
            event: 'ai.run.recovery_failed',
            error: error instanceof Error ? error.message : 'unknown',
          },
          'AI run recovery cycle failed'
        )
        return failed(errorCode(error))
      }
    })
  }
}
