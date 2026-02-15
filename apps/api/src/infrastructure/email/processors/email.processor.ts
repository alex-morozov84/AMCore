import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'

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
  private readonly logger = new Logger(EmailProcessor.name)

  constructor(private readonly emailService: EmailService) {
    super()
  }

  async process(job: Job<SendEmailJobData>): Promise<void> {
    // Only process send-email jobs
    if (job.name !== JobName.SEND_EMAIL) {
      this.logger.warn(`Skipped unknown job type: ${job.name}`)
      return
    }

    const { template, to, data } = job.data

    this.logger.log(`Processing email job ${job.id}`, {
      template,
      to,
      attempt: job.attemptsMade + 1,
    })

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

      this.logger.log(`Email sent successfully`, {
        id: result.id,
        template,
        to,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'

      this.logger.error(`Email sending failed`, {
        jobId: job.id,
        template,
        to,
        error: message,
        attempt: job.attemptsMade + 1,
      })

      // Re-throw to trigger BullMQ retry logic
      throw error
    }
  }
}
