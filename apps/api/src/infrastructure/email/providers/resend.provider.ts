import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { Resend } from 'resend'

import type { EmailProvider, SendEmailParams, SendEmailResult } from '../email.types'

import { EnvService } from '@/env/env.service'

/**
 * Resend error codes that will NOT heal on an immediate in-process retry
 * (EQS-03): malformed config/payload, auth/permission, idempotency-key misuse,
 * and quota exhaustion (which resets on a day/month timescale, far beyond the
 * `attempts` retry window). These map to `retryable: false` so the processor
 * raises `UnrecoverableError` and dead-letters instead of burning retries.
 * Any code not listed here (rate limits, 5xx, application errors, unknown) is
 * treated as transient → `retryable: true`.
 */
const DETERMINISTIC_RESEND_ERROR_CODES: ReadonlySet<string> = new Set([
  'validation_error',
  'missing_required_field',
  'invalid_parameter',
  'invalid_attachment',
  'invalid_from_address',
  'invalid_region',
  'invalid_access',
  'missing_api_key',
  'invalid_api_key',
  'restricted_api_key',
  'not_found',
  'method_not_allowed',
  'security_error',
  'invalid_idempotency_key',
  'invalid_idempotent_request',
  'daily_quota_exceeded',
  'monthly_quota_exceeded',
])

/**
 * Resend Email Provider
 *
 * Production email provider using Resend API.
 * Requires RESEND_API_KEY environment variable.
 */
@Injectable()
export class ResendEmailProvider implements EmailProvider {
  private readonly resend: Resend

  constructor(
    private readonly env: EnvService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(ResendEmailProvider.name)
    const apiKey = this.env.get('RESEND_API_KEY')

    if (!apiKey) {
      throw new Error('RESEND_API_KEY is required for Resend provider')
    }

    this.resend = new Resend(apiKey)
    this.logger.info('Resend provider initialized')
  }

  async send(params: SendEmailParams): Promise<SendEmailResult> {
    const { to, subject, html, text, from, replyTo, idempotencyKey } = params

    try {
      const { data, error } = await this.resend.emails.send(
        {
          from: from || this.env.get('EMAIL_FROM'),
          to: [to],
          subject,
          html,
          text,
          replyTo,
        },
        // Forwarded as the `Idempotency-Key` header so retries de-duplicate at
        // Resend (EQS-03). Undefined when the caller did not set one.
        idempotencyKey ? { idempotencyKey } : undefined
      )

      if (error) {
        const retryable = !DETERMINISTIC_RESEND_ERROR_CODES.has(error.name)
        // warn, not error: a single attempt failing is not a terminal incident.
        // The processor owns the error-level `email.job.dead_letter` signal once
        // a job is truly terminal (EQS-03); error here would alert on every
        // transient retry.
        this.logger.warn(
          { to, subject, errorCode: error.name, error: error.message, retryable },
          'Failed to send email via Resend'
        )

        return {
          id: '',
          success: false,
          error: error.message,
          retryable,
        }
      }

      this.logger.info({ id: data?.id, to, subject }, 'Email sent successfully via Resend')

      return {
        id: data?.id || '',
        success: true,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'

      // Thrown (network/timeout/unexpected) — transient by default, retry.
      // warn, not error (per-attempt; the processor owns the terminal signal).
      this.logger.warn({ to, subject, error: message }, 'Resend API error')

      return {
        id: '',
        success: false,
        error: message,
        retryable: true,
      }
    }
  }
}
