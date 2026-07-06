import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { AI_RUN_CLAIM_BATCH_LIMIT, AI_RUN_MAX_DRAIN_CYCLES } from './ai-run.constants'
import { AiRunRepository } from './ai-run.repository'
import { AiRunExecutorService } from './ai-run-executor.service'

/**
 * Drains due AI runs (Track C — ADR-054, ADR-052 pattern, worker role only). Invoked by both the
 * BullMQ wake job (`drainDueBatches`) and the recovery `@Cron` (`runDispatchCycle`); both are safe
 * to run concurrently on every replica because every claim uses `FOR UPDATE SKIP LOCKED`. This
 * service owns no provider I/O and no state machine — it claims a batch through the repository and
 * hands each claim to the executor, which performs the single provider call + finalization.
 */
@Injectable()
export class AiRunDispatchService {
  constructor(
    private readonly repository: AiRunRepository,
    private readonly executor: AiRunExecutorService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiRunDispatchService.name)
  }

  /** Recovery pass: reclaim crashed leases, sweep overdue queued runs, then drain the backlog. */
  async runDispatchCycle(): Promise<void> {
    await this.reap()
    await this.drainDueBatches()
  }

  /** Reclaim expired leases (crashed/stalled workers) and expire overdue never-run queued runs. */
  async reap(): Promise<void> {
    const { rescheduled, failed } = await this.repository.reapExpiredLeases()
    const expired = await this.repository.expireDeadlinedRuns()
    if (rescheduled > 0 || failed > 0 || expired > 0) {
      this.logger.warn(
        { event: 'ai.run.reaped', rescheduled, failed, expired },
        'Reclaimed expired AI run leases and swept overdue queued runs'
      )
    }
  }

  /** Claim + execute due runs in bounded batches until a short batch (or the drain-cycle cap). */
  async drainDueBatches(): Promise<void> {
    for (let cycle = 0; cycle < AI_RUN_MAX_DRAIN_CYCLES; cycle += 1) {
      const claimed = await this.repository.claimDueBatch()
      if (claimed.length === 0) return
      for (const claim of claimed) {
        await this.executor.execute(claim)
      }
      if (claimed.length < AI_RUN_CLAIM_BATCH_LIMIT) return
    }
  }
}
