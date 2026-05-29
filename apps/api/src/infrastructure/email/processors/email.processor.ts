import { Processor, WorkerHost } from '@nestjs/bullmq'
import type { Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'

import { EmailService } from '../email.service'
import type { SendEmailJobData } from '../email.types'
import { QUEUEABLE_EMAIL_TEMPLATES } from '../email.types'

import { JobName, QueueName } from '@/infrastructure/queue/constants/queues.constant'

/**
 * Email Processor
 *
 * BullMQ worker that processes email sending jobs asynchronously.
 * Handles template rendering and email delivery with automatic retries.
 */
@Processor(QueueName.EMAIL)
export class EmailProcessor extends WorkerHost {
  constructor(
    private readonly emailService: EmailService,
    private readonly logger: PinoLogger
  ) {
    super()
    this.logger.setContext(EmailProcessor.name)
  }

  async process(job: Job<SendEmailJobData>): Promise<void> {
    // Only process send-email jobs
    if (job.name !== JobName.SEND_EMAIL) {
      this.logger.warn({ jobName: job.name }, 'Skipped unknown job type')
      return
    }

    const { template, to, data } = job.data

    // EQS-02 boundary guard. The type narrowing on `SendEmailJobData` protects
    // the enqueue path, but job data is deserialized from Redis at runtime and
    // is therefore untrusted — a legacy job (queued before Stage 2) or a
    // manually-injected one could carry a secret-bearing template + token URL.
    // Discard such jobs WITHOUT rendering/sending (never emit a secret email
    // from an untrusted source) and WITHOUT throwing. Returning normally moves
    // the job to completed; its payload is then retained only briefly per
    // `removeOnComplete` (age 1h / last 100) — versus throwing, which would
    // retry the token-bearing job and retain it far longer (`removeOnFail`,
    // 24h). The brief completed-state retention is bounded and the UI that
    // would surface it is auth-gated (EQS-01); we deliberately do not mutate an
    // active job's data mid-process to scrub it. Never log `data` — token URL.
    if (!QUEUEABLE_EMAIL_TEMPLATES.has(template)) {
      this.logger.warn(
        { jobId: job.id, template, to },
        'Discarded non-queueable email job (secret-bearing templates must not be queued — EQS-02)'
      )
      return
    }

    this.logger.info(
      { jobId: job.id, template, to, attempt: job.attemptsMade + 1 },
      `Processing email job ${job.id}`
    )

    try {
      // Render template
      const { html, subject } = await this.emailService.renderTemplate(template, data)

      // Send email
      const result = await this.emailService.send({
        to,
        subject,
        html,
      })

      if (!result.success) {
        throw new Error(result.error || 'Email sending failed')
      }

      this.logger.info({ id: result.id, template, to }, 'Email sent successfully')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'

      this.logger.error(
        { jobId: job.id, template, to, error: message, attempt: job.attemptsMade + 1 },
        'Email sending failed'
      )

      // Re-throw to trigger BullMQ retry logic
      throw error
    }
  }
}
