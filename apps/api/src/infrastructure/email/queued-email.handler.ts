import { Injectable } from '@nestjs/common'
import { type Job, UnrecoverableError } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'

import type { WorkHandler, WorkInvocation } from '../background-work/work-definition'

import { EmailService } from './email.service'
import { EmailTemplate } from './email.types'

import { type EmailMetricsTemplate, MetricsService } from '@/infrastructure/observability'
import { QueueName } from '@/infrastructure/queue/constants/queues.constant'

/** Approved recipe has no direct provider access; its effect port admits immutable bytes once. */
@Injectable()
export class QueuedEmailHandler implements WorkHandler {
  constructor(
    private readonly email: EmailService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {}

  async prepareRequest(payload: unknown): Promise<string> {
    try {
      return await this.email.prepareQueuedRequest(payload)
    } catch {
      throw new UnrecoverableError('PERMANENT_FAILURE')
    }
  }

  async run(_payload: unknown, context: WorkInvocation): Promise<void> {
    if (!context.effect) throw new UnrecoverableError('ACTION_UNAVAILABLE')
    await context.effect.send()
  }

  onFailed(job: Job, error: Error): void {
    const unrecoverable = error.name === 'UnrecoverableError'
    if (!unrecoverable && job.attemptsMade < (job.opts.attempts ?? 1)) return
    const input: unknown = job.data?.protocolVersion === 1 ? job.data.payload : job.data
    const raw =
      input && typeof input === 'object' ? (input as Record<string, unknown>).template : undefined
    const template: EmailMetricsTemplate =
      typeof raw === 'string' && Object.values(EmailTemplate).includes(raw as EmailTemplate)
        ? (raw as EmailMetricsTemplate)
        : 'unknown'
    this.metrics.incQueueEvent(QueueName.EMAIL, 'dead_letter')
    this.metrics.incEmailDeadLetter(template, unrecoverable)
    this.logger.error(
      {
        event: 'email.job.dead_letter',
        jobId: job.id,
        template,
        attemptsMade: job.attemptsMade,
        unrecoverable,
      },
      'Email job dead-lettered'
    )
  }

  onError(): void {
    this.metrics.incRedisClientEvent('queue_worker', 'error')
    this.metrics.incQueueEvent(QueueName.EMAIL, 'worker_error')
    this.logger.error({ event: 'queue.worker_error' }, 'Email worker Redis/connection error')
  }
}
