import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import type { Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'

import { dispatchDueJobSchema } from '../notification-dispatch.schema'

import { NotificationDispatchService } from './notification-dispatch.service'

import { MetricsService } from '@/infrastructure/observability'
import { JobName, QueueName } from '@/infrastructure/queue/constants/queues.constant'

/**
 * BullMQ consumer for `QueueName.NOTIFICATIONS` (ADR-052). A `DISPATCH_DUE` job is a
 * wake hint only — it triggers a drain of ALL due deliveries via the dispatcher, it does
 * not carry or retry a specific delivery (BullMQ `attempts: 1`; Postgres owns retry). A
 * thrown drain is not retried by BullMQ — the recovery `@Cron` re-drains regardless, so a
 * failed wake never strands work.
 */
@Processor(QueueName.NOTIFICATIONS)
export class NotificationDispatchProcessor extends WorkerHost {
  constructor(
    private readonly dispatch: NotificationDispatchService,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService
  ) {
    super()
    this.logger.setContext(NotificationDispatchProcessor.name)
  }

  async process(job: Job): Promise<void> {
    if (job.name !== JobName.DISPATCH_DUE) {
      this.logger.warn({ jobName: job.name }, 'Skipped unknown notification job type')
      return
    }

    // The payload is untrusted Redis JSON; validate for the contract/observability, but a
    // wake carries no work — the drain is independent of it, so drain even if it is invalid.
    const parsed = dispatchDueJobSchema.safeParse(job.data)
    if (!parsed.success) {
      this.logger.warn(
        { jobId: job.id, issues: parsed.error.issues.map((issue) => issue.path.join('.')) },
        'Invalid notification wake payload — draining due deliveries anyway'
      )
    }

    await this.dispatch.drainDueBatches()
  }

  /** A wake job that exhausted its single attempt (drain threw). The cron recovers. */
  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error): void {
    this.metrics.incQueueEvent(QueueName.NOTIFICATIONS, 'dead_letter')
    this.logger.error(
      { event: 'notification.dispatch_job_failed', jobId: job.id, error: error?.message },
      'Notification dispatch wake failed (recovery cron will re-drain)'
    )
  }

  /** Worker-side Redis/connection observability (mirrors EmailProcessor). */
  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.metrics.incRedisClientEvent('queue_worker', 'error')
    this.metrics.incQueueEvent(QueueName.NOTIFICATIONS, 'worker_error')
    this.logger.error(
      { event: 'queue.worker_error', error: error?.message },
      'Notification worker Redis/connection error'
    )
  }
}
