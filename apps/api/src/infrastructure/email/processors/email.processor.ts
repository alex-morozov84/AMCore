import { Processor, WorkerHost } from '@nestjs/bullmq'
import type { Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'

import { EmailService } from '../email.service'
import type { SendEmailJobData } from '../email.types'

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
