import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import type { Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'

import { AiRunDispatchService } from './ai-run-dispatch.service'
import { aiRunWakeJobSchema } from './ai-run-wake.schema'

import { MetricsService } from '@/infrastructure/observability'
import { JobName, QueueName } from '@/infrastructure/queue/constants/queues.constant'

/**
 * BullMQ consumer for `QueueName.AI_RUNS` (Track C — ADR-054, ADR-052 pattern, worker role only).
 * An `AI_RUN_WAKE` job is a wake hint only — it triggers a drain of ALL due runs via the dispatcher;
 * it does not carry or retry a specific run (BullMQ `attempts: 1`; Postgres owns the run retry). A
 * thrown drain is not retried by BullMQ — the recovery `@Cron` re-drains regardless, so a failed or
 * lost wake never strands a queued run.
 */
@Processor(QueueName.AI_RUNS)
export class AiRunDispatchProcessor extends WorkerHost {
  constructor(
    private readonly dispatch: AiRunDispatchService,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService
  ) {
    super()
    this.logger.setContext(AiRunDispatchProcessor.name)
  }

  async process(job: Job): Promise<void> {
    if (job.name !== JobName.AI_RUN_WAKE) {
      this.logger.warn({ jobName: job.name }, 'Skipped unknown AI run job type')
      return
    }

    // BullMQ job data is untrusted deserialized Redis JSON; validate for the contract, but a wake
    // carries no work — the drain is independent of it, so drain even when the payload is invalid.
    const parsed = aiRunWakeJobSchema.safeParse(job.data)
    if (!parsed.success) {
      this.logger.warn(
        { jobId: job.id, issues: parsed.error.issues.map((issue) => issue.path.join('.')) },
        'Invalid AI run wake payload — draining due runs anyway'
      )
    }

    await this.dispatch.drainDueBatches()
  }

  /** A wake job that exhausted its single attempt (drain threw). The recovery cron re-drains. */
  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error): void {
    this.metrics.incQueueEvent(QueueName.AI_RUNS, 'dead_letter')
    this.logger.error(
      { event: 'ai.run.wake_job_failed', jobId: job.id, error: error?.message },
      'AI run wake failed (recovery cron will re-drain)'
    )
  }

  /** Worker-side Redis/connection observability (mirrors the notification dispatch processor). */
  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.metrics.incRedisClientEvent('queue_worker', 'error')
    this.metrics.incQueueEvent(QueueName.AI_RUNS, 'worker_error')
    this.logger.error(
      { event: 'queue.worker_error', error: error?.message },
      'AI run worker Redis/connection error'
    )
  }
}
