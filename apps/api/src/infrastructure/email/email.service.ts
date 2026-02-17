import { Inject, Injectable, Logger } from '@nestjs/common'
import { render } from '@react-email/render'

import type {
  EmailProvider,
  EmailVerificationData,
  PasswordChangedEmailData,
  PasswordResetEmailData,
  SendEmailJobData,
  SendEmailParams,
  SendEmailResult,
  WelcomeEmailData,
} from './email.types'
import { EmailTemplate } from './email.types'
import type { Locale } from './messages'
import { EmailVerificationEmail, getEmailVerificationSubject } from './templates/email-verification'
import { getPasswordChangedSubject, PasswordChangedEmail } from './templates/password-changed'
import { getPasswordResetSubject, PasswordResetEmail } from './templates/password-reset'
import { getWelcomeSubject, WelcomeEmail } from './templates/welcome'

import { EnvService } from '@/env/env.service'
import { JobName, QueueName } from '@/infrastructure/queue/constants/queues.constant'
import { QueueService } from '@/infrastructure/queue/queue.service'

/**
 * Email Service
 *
 * Main email service that handles template rendering and sending.
 * Uses provider pattern (Resend/Mock) for actual email delivery.
 * Supports async sending via BullMQ queue.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name)

  constructor(
    @Inject('EmailProvider') private readonly emailProvider: EmailProvider,
    private readonly queueService: QueueService,
    private readonly env: EnvService
  ) {
    this.logger.log(`Email service initialized with ${emailProvider.constructor.name}`)
  }

  /**
   * Send email immediately (synchronous)
   */
  async send(params: SendEmailParams): Promise<SendEmailResult> {
    return this.emailProvider.send(params)
  }

  /**
   * Queue email for async sending (via BullMQ)
   */
  async queue(jobData: SendEmailJobData): Promise<void> {
    await this.queueService.add(QueueName.EMAIL, JobName.SEND_EMAIL, jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000, // Start with 2 seconds
      },
    })

    this.logger.log('Email queued', {
      template: jobData.template,
      to: jobData.to,
    })
  }

  /**
   * Send welcome email after registration
   */
  async sendWelcomeEmail(data: WelcomeEmailData): Promise<void> {
    await this.queue({
      template: EmailTemplate.WELCOME,
      to: data.email,
      data,
    })
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email: string, data: PasswordResetEmailData): Promise<void> {
    await this.queue({
      template: EmailTemplate.PASSWORD_RESET,
      to: email,
      data,
    })
  }

  /**
   * Send email verification email
   */
  async sendEmailVerificationEmail(email: string, data: EmailVerificationData): Promise<void> {
    await this.queue({
      template: EmailTemplate.EMAIL_VERIFICATION,
      to: email,
      data,
    })
  }

  /**
   * Send password changed notification email
   */
  async sendPasswordChangedEmail(email: string, data: PasswordChangedEmailData): Promise<void> {
    await this.queue({
      template: EmailTemplate.PASSWORD_CHANGED,
      to: email,
      data,
    })
  }

  /**
   * Render email template to HTML
   *
   * @param template - Template to render
   * @param data - Template data
   * @returns Rendered HTML and localized subject
   */
  async renderTemplate(
    template: EmailTemplate,
    data:
      | WelcomeEmailData
      | PasswordResetEmailData
      | EmailVerificationData
      | PasswordChangedEmailData
  ): Promise<{ html: string; subject: string }> {
    const locale: Locale = data.locale || 'ru'
    let html: string
    let subject: string

    switch (template) {
      case EmailTemplate.WELCOME:
        html = await render(WelcomeEmail(data as WelcomeEmailData))
        subject = getWelcomeSubject(locale)
        break

      case EmailTemplate.PASSWORD_RESET:
        html = await render(PasswordResetEmail(data as PasswordResetEmailData))
        subject = getPasswordResetSubject(locale)
        break

      case EmailTemplate.EMAIL_VERIFICATION:
        html = await render(EmailVerificationEmail(data as EmailVerificationData))
        subject = getEmailVerificationSubject(locale)
        break

      case EmailTemplate.PASSWORD_CHANGED:
        html = await render(PasswordChangedEmail(data as PasswordChangedEmailData))
        subject = getPasswordChangedSubject(locale)
        break

      default:
        throw new Error(`Unknown template: ${template}`)
    }

    return { html, subject }
  }
}
