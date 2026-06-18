import { performance } from 'node:perf_hooks'

import { Inject, Injectable } from '@nestjs/common'
import { render } from '@react-email/render'
import { PinoLogger } from 'nestjs-pino'

import type {
  EmailProvider,
  EmailVerificationData,
  NotificationEmailData,
  OrgInviteEmailData,
  PasswordChangedEmailData,
  PasswordResetEmailData,
  RenderableEmailData,
  RenderableEmailTemplate,
  SendEmailJobData,
  SendEmailParams,
  SendEmailResult,
  WelcomeEmailData,
} from './email.types'
import { EmailTemplate, QUEUEABLE_EMAIL_TEMPLATES } from './email.types'
import type { Locale } from './messages'
import { EmailVerificationEmail, getEmailVerificationSubject } from './templates/email-verification'
import { NotificationEmail } from './templates/notification'
import { getOrgInviteSubject, OrgInviteEmail } from './templates/org-invite'
import { getPasswordChangedSubject, PasswordChangedEmail } from './templates/password-changed'
import { getPasswordResetSubject, PasswordResetEmail } from './templates/password-reset'
import { getWelcomeSubject, WelcomeEmail } from './templates/welcome'

import { EnvService } from '@/env/env.service'
import {
  type EmailMetricsMode,
  type EmailMetricsTemplate,
  MetricsService,
} from '@/infrastructure/observability'
import { JobName, QueueName } from '@/infrastructure/queue/constants/queues.constant'
import { DEFAULT_JOB_OPTIONS } from '@/infrastructure/queue/interfaces/job-options.interface'
import { QueueService } from '@/infrastructure/queue/queue.service'

/**
 * Job options for queued (non-secret) emails (EQS-11).
 *
 * Derived from the single-source `DEFAULT_JOB_OPTIONS`; overrides only the
 * first-retry backoff to 2s — email retries are intentionally gentler than the
 * generic 1s default. A named derived constant removes the duplicate literal
 * without changing retry timing.
 */
const EMAIL_JOB_OPTIONS = {
  ...DEFAULT_JOB_OPTIONS,
  backoff: { type: 'exponential' as const, delay: 2000 },
}

/**
 * Email Service
 *
 * Main email service that handles template rendering and sending.
 * Uses provider pattern (Resend/Mock) for actual email delivery.
 * Supports async sending via BullMQ queue.
 */
@Injectable()
export class EmailService {
  constructor(
    @Inject('EmailProvider') private readonly emailProvider: EmailProvider,
    private readonly queueService: QueueService,
    private readonly env: EnvService,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService
  ) {
    this.logger.setContext(EmailService.name)
    this.logger.info(
      { provider: emailProvider.constructor.name },
      `Email service initialized with ${emailProvider.constructor.name}`
    )
  }

  /**
   * Send email immediately (synchronous)
   */
  async send(
    params: SendEmailParams,
    context: { template: EmailMetricsTemplate; mode: 'direct' | 'worker' } = {
      template: 'unknown',
      mode: 'direct',
    }
  ): Promise<SendEmailResult> {
    const startedAt = performance.now()
    try {
      const result = await this.emailProvider.send(params)
      this.observe(
        context.template,
        'send',
        context.mode,
        result.success ? 'success' : 'error',
        result.retryable,
        startedAt
      )
      return result
    } catch (error) {
      this.observe(context.template, 'send', context.mode, 'error', undefined, startedAt)
      throw error
    }
  }

  /**
   * Queue email for async sending (via BullMQ).
   *
   * Only non-secret (`QueueableEmailTemplate`) emails may be enqueued. The
   * runtime guard backs up the compile-time `SendEmailJobData` narrowing for
   * callers that bypass TypeScript — a secret-bearing template must never be
   * persisted in BullMQ/Redis/Bull Board (EQS-02). Use `sendNow` for those.
   */
  async queue(jobData: SendEmailJobData): Promise<void> {
    const startedAt = performance.now()
    try {
      if (!QUEUEABLE_EMAIL_TEMPLATES.has(jobData.template)) {
        throw new Error(
          `Refusing to enqueue non-queueable email template "${jobData.template}": ` +
            'secret-bearing templates must be sent via sendNow (EQS-02)'
        )
      }

      await this.queueService.add(QueueName.EMAIL, JobName.SEND_EMAIL, jobData, EMAIL_JOB_OPTIONS)
      this.observe(jobData.template, 'dispatch', 'queued', 'success', undefined, startedAt)
      this.logger.info({ template: jobData.template, to: jobData.to }, 'Email queued')
    } catch (error) {
      this.observe(jobData.template, 'dispatch', 'queued', 'error', undefined, startedAt)
      throw error
    }
  }

  /**
   * Send an email immediately, in-process, WITHOUT enqueuing (EQS-02).
   *
   * Used for secret-bearing templates (password reset, email verification, org
   * invite): the rendered token URL lives only in memory → render → provider,
   * so the raw token is never serialized into BullMQ/Redis/Bull Board. Throws
   * on send failure so the caller's existing best-effort/await semantics apply.
   * Never logs the payload (which carries the token URL) — only template + to.
   */
  async sendNow(
    template: RenderableEmailTemplate,
    to: string,
    data: RenderableEmailData
  ): Promise<void> {
    const { html, text, subject } = await this.renderTemplate(template, data, 'direct')
    const result = await this.send({ to, subject, html, text }, { template, mode: 'direct' })

    if (!result.success) {
      throw new Error(result.error || 'Email sending failed')
    }

    this.logger.info({ template, to }, 'Email sent (direct, not queued)')
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
   * Send password reset email.
   *
   * Direct send (EQS-02) — the reset token URL must never be enqueued.
   */
  async sendPasswordResetEmail(email: string, data: PasswordResetEmailData): Promise<void> {
    await this.sendNow(EmailTemplate.PASSWORD_RESET, email, data)
  }

  /**
   * Send email verification email.
   *
   * Direct send (EQS-02) — the verification token URL must never be enqueued.
   */
  async sendEmailVerificationEmail(email: string, data: EmailVerificationData): Promise<void> {
    await this.sendNow(EmailTemplate.EMAIL_VERIFICATION, email, data)
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
   * Send organization invite email (OB-02).
   *
   * Dispatched by `InviteService.createInvite` after the invite row is
   * committed, carrying the raw accept token inside `data.acceptUrl`.
   */
  async sendOrgInviteEmail(email: string, data: OrgInviteEmailData): Promise<void> {
    await this.sendNow(EmailTemplate.ORG_INVITE, email, data)
  }

  /**
   * Render an email template to a multipart HTML + plaintext body (EQS-08).
   *
   * @param template - Template to render
   * @param data - Template data
   * @returns Rendered HTML, a derived plaintext alternative, and the localized subject
   */
  async renderTemplate(
    template: EmailTemplate,
    data: RenderableEmailData,
    mode: EmailMetricsMode = 'direct'
  ): Promise<{ html: string; text: string; subject: string }> {
    const startedAt = performance.now()
    try {
      const locale: Locale = data.locale || 'ru'
      let element: Parameters<typeof render>[0]
      let subject: string

      switch (template) {
        case EmailTemplate.WELCOME:
          element = WelcomeEmail(data as WelcomeEmailData)
          subject = getWelcomeSubject(locale)
          break

        case EmailTemplate.PASSWORD_RESET:
          element = PasswordResetEmail(data as PasswordResetEmailData)
          subject = getPasswordResetSubject(locale)
          break

        case EmailTemplate.EMAIL_VERIFICATION:
          element = EmailVerificationEmail(data as EmailVerificationData)
          subject = getEmailVerificationSubject(locale)
          break

        case EmailTemplate.PASSWORD_CHANGED:
          element = PasswordChangedEmail(data as PasswordChangedEmailData)
          subject = getPasswordChangedSubject(locale)
          break

        case EmailTemplate.ORG_INVITE: {
          const inviteData = data as OrgInviteEmailData
          element = OrgInviteEmail(inviteData)
          subject = getOrgInviteSubject(inviteData.orgName, locale)
          break
        }

        case EmailTemplate.NOTIFICATION: {
          const notificationData = data as NotificationEmailData
          element = NotificationEmail(notificationData)
          // The dispatcher already applied the content policy to the title, so it is a
          // safe subject for both detailed and neutral/generic notifications.
          subject = notificationData.title
          break
        }

        default:
          throw new Error(`Unknown template: ${template}`)
      }

      // Render the HTML and a plaintext alternative from the SAME component
      // (EQS-08). React Email derives the text from the rendered HTML via
      // html-to-text, so there is no second text source to maintain and no
      // html/text drift. Multipart html+text improves deliverability and is
      // readable by text-only/accessibility clients.
      const [html, text] = await Promise.all([
        render(element),
        render(element, { plainText: true }),
      ])
      this.observe(template, 'render', mode, 'success', undefined, startedAt)
      return { html, text, subject }
    } catch (error) {
      this.observe(this.metricTemplate(template), 'render', mode, 'error', false, startedAt)
      throw error
    }
  }

  private observe(
    template: EmailMetricsTemplate,
    operation: 'dispatch' | 'render' | 'send',
    mode: EmailMetricsMode,
    result: 'success' | 'error',
    retryable: boolean | undefined,
    startedAt: number
  ): void {
    this.metrics.observeEmailOperation(
      {
        template,
        operation,
        mode,
        result,
        retryable: retryable === undefined ? 'unknown' : retryable ? 'true' : 'false',
      },
      (performance.now() - startedAt) / 1000
    )
  }

  private metricTemplate(template: string): EmailMetricsTemplate {
    return Object.values(EmailTemplate).includes(template as EmailTemplate)
      ? (template as EmailMetricsTemplate)
      : 'unknown'
  }
}
