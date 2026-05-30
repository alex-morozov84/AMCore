import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { type Job, UnrecoverableError } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'

import { sendEmailJobDataSchema } from '../email.schema'
import { EmailService } from '../email.service'
import type { EmailTemplate, SendEmailJobData } from '../email.types'
import { SECRET_EMAIL_TEMPLATES } from '../email.types'

import { JobName, QueueName } from '@/infrastructure/queue/constants/queues.constant'

/**
 * Email Processor
 *
 * BullMQ worker that renders + sends queued (non-secret) email jobs.
 *
 * Failure taxonomy (EQS-03, ADR-006 amendment):
 * - Deterministic failures — non-queueable/secret template (discarded),
 *   invalid payload, render failure, or a deterministic provider error — are
 *   raised as `UnrecoverableError` so BullMQ does NOT retry (the same deployed
 *   code + same job data will not heal on retry).
 * - Transient failures — provider 5xx / network / rate-limit / unknown — are
 *   thrown as plain `Error` so BullMQ retries (bounded by `attempts`), then the
 *   `failed` handler emits a single `email.job.dead_letter` signal.
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

    // Job data is untrusted Redis JSON — it may be null, a non-object, or
    // missing fields. Read it defensively; do NOT destructure assuming shape
    // (a TypeError here would be retried as a transient failure, which is wrong).
    const raw: unknown = job.data
    const rawRecord =
      typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    const template = typeof rawRecord.template === 'string' ? rawRecord.template : undefined
    const to = typeof rawRecord.to === 'string' ? rawRecord.to : undefined

    // EQS-02 boundary guard — MUST stay first, and fire ONLY for a KNOWN
    // secret-bearing template. Discard WITHOUT rendering/sending and WITHOUT
    // throwing: returning completes the job (retained only briefly per
    // `removeOnComplete`), whereas throwing would retry/retain the token-bearing
    // payload far longer (`removeOnFail`, 24h). A garbage/missing template is
    // deliberately NOT caught here — it falls through to validation so it is
    // observably dead-lettered, not silently completed. Never log `data`.
    if (template !== undefined && SECRET_EMAIL_TEMPLATES.has(template as EmailTemplate)) {
      this.logger.warn(
        { jobId: job.id, template, to },
        'Discarded secret-bearing email job (must not be queued — EQS-02)'
      )
      return
    }

    // EQS-07 runtime validation. The compile-time `SendEmailJobData` type is not
    // a runtime guarantee for deserialized Redis data. null / non-object /
    // missing-field / unknown-template all fail here → deterministic
    // `UnrecoverableError` (no retry), surfaced via the dead-letter handler.
    // Log only the failing field paths, never the payload values.
    const parsed = sendEmailJobDataSchema.safeParse(raw)
    if (!parsed.success) {
      this.logger.warn(
        { jobId: job.id, template, to, issues: parsed.error.issues.map((i) => i.path.join('.')) },
        'Invalid email job payload — discarding without retry'
      )
      throw new UnrecoverableError('Invalid email job payload')
    }

    this.logger.info(
      {
        jobId: job.id,
        template: parsed.data.template,
        to: parsed.data.to,
        attempt: job.attemptsMade + 1,
      },
      `Processing email job ${job.id}`
    )

    // Render — deterministic. A render failure will not heal on retry (same
    // deployed template code + same validated data), so it is unrecoverable.
    let rendered: { html: string; text: string; subject: string }
    try {
      rendered = await this.emailService.renderTemplate(parsed.data.template, parsed.data.data)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      this.logger.warn(
        { jobId: job.id, template, to, error: message },
        'Email render failed (deterministic) — discarding without retry'
      )
      throw new UnrecoverableError(`Email render failed: ${message}`)
    }

    // Send — idempotency-keyed on the job id so a retry after a post-accept blip
    // does not double-send. Classify failure by the provider's `retryable` flag.
    const result = await this.emailService.send({
      to: parsed.data.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: job.id ? `email:${job.id}` : undefined,
    })

    if (!result.success) {
      const message = result.error || 'Email sending failed'

      if (result.retryable === false) {
        this.logger.warn(
          { jobId: job.id, template, to, error: message },
          'Email send failed (deterministic) — discarding without retry'
        )
        throw new UnrecoverableError(message)
      }

      this.logger.warn(
        { jobId: job.id, template, to, error: message, attempt: job.attemptsMade + 1 },
        'Email send failed (transient) — will retry'
      )
      throw new Error(message)
    }

    this.logger.info({ id: result.id, template, to }, 'Email sent successfully')
  }

  /**
   * Terminal failure signal (EQS-03). Fires once a job will not be retried
   * again — either it raised `UnrecoverableError` or it exhausted `attempts`.
   * This is the single error-level dead-letter event to alert on; per-attempt
   * failures are logged at `warn` in `process`. Never logs the payload.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<SendEmailJobData>, error: Error): void {
    const maxAttempts = job.opts?.attempts ?? 1
    const terminal = error?.name === 'UnrecoverableError' || job.attemptsMade >= maxAttempts
    if (!terminal) return

    this.logger.error(
      {
        event: 'email.job.dead_letter',
        jobId: job.id,
        template: job.data?.template,
        to: job.data?.to,
        attemptsMade: job.attemptsMade,
        unrecoverable: error?.name === 'UnrecoverableError',
        error: error?.message,
      },
      'Email job dead-lettered (will not be retried)'
    )
  }

  /**
   * Worker-side Redis/connection observability (EQS-06). The worker holds its
   * own blocking connection (BRPOPLPUSH), separate from the producer's queue
   * client. Without this, a Redis outage can stall job processing with NO
   * `email.job.dead_letter` (jobs aren't failing — they're un-pulled) and no
   * producer-side add failure. This is the worker-side counterpart to
   * `QueueService`'s `queue.redis_error`. Never logs job payloads.
   */
  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error(
      { event: 'queue.worker_error', error: error?.message },
      'Email worker Redis/connection error'
    )
  }
}
