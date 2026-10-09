import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { Resend } from 'resend'

import type { EmailProvider, SendEmailParams, SendEmailResult } from '../email.types'
import { parseRetryAfterMs } from '../retry-after'

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

    this.resend = new Resend(apiKey, { baseUrl: 'https://api.resend.com' })
    // The SDK's private `logError` prints the RAW parsed provider error (message text and all)
    // to the console whenever NODE_ENV !== 'production'. Neutralize it on THIS instance — no
    // global console patch, no NODE_ENV mutation — so the no-raw-provider-text invariant
    // (docs/email/security.md) also holds through the real SDK in development/test. Pinned by a
    // real-SDK contract test that fails if a future SDK changes this surface.
    ;(this.resend as unknown as { logError: () => void }).logError = () => undefined
    this.logger.info('Resend provider initialized')
  }

  async sendPrepared(
    body: string,
    idempotencyKey: string,
    signal: AbortSignal
  ): Promise<SendEmailResult> {
    try {
      const { data, error, headers } = await this.resend.fetchRequest<{ id: string }>('/emails', {
        method: 'POST',
        body,
        signal,
        headers: {
          Authorization: `Bearer ${this.env.get('RESEND_API_KEY')}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
      })
      if (!error) return { id: data?.id ?? '', success: true }
      const retryable = !DETERMINISTIC_RESEND_ERROR_CODES.has(error.name)
      const known =
        !retryable ||
        ['rate_limit_exceeded', 'application_error', 'internal_server_error'].includes(error.name)
      const retryAfterMs = retryable ? parseRetryAfterMs(headers?.['retry-after']) : undefined
      return {
        id: '',
        success: false,
        error: known ? error.name : 'provider_failure',
        retryable,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      }
    } catch {
      return { id: '', success: false, error: 'provider_failure', retryable: true }
    }
  }

  async send(params: SendEmailParams): Promise<SendEmailResult> {
    const { to, subject, html, text, from, replyTo, idempotencyKey, signal } = params

    try {
      const { data, error, headers } = await this.resend.emails.send(
        {
          from: from || this.env.get('EMAIL_FROM'),
          to: [to],
          subject,
          html,
          text,
          replyTo,
        },
        // The SECOND argument of `emails.send(payload, options)` — spread into `fetch`. The
        // `Idempotency-Key` header lets retries de-duplicate at Resend (EQS-03); `signal` lets
        // the delivery attempt's timeout/shutdown abort the request. `signal` is untyped in the
        // SDK's `PostOptions` (hence the cast) and undocumented, so capacity correctness never
        // depends on it — the dispatcher holds its slot until the call settles regardless.
        // Undefined when neither is set.
        idempotencyKey || signal
          ? ({
              ...(idempotencyKey ? { idempotencyKey } : {}),
              ...(signal ? { signal } : {}),
            } as { idempotencyKey?: string })
          : undefined
      )

      if (error) {
        const retryable = !DETERMINISTIC_RESEND_ERROR_CODES.has(error.name)
        const errorCode =
          DETERMINISTIC_RESEND_ERROR_CODES.has(error.name) ||
          ['rate_limit_exceeded', 'application_error', 'internal_server_error'].includes(error.name)
            ? error.name
            : 'provider_failure'
        // warn, not error: a single attempt failing is not a terminal incident.
        // The processor owns the error-level `email.job.dead_letter` signal once
        // a job is truly terminal (EQS-03); error here would alert on every
        // transient retry.
        this.logger.warn({ to, subject, errorCode, retryable }, 'Failed to send email via Resend')

        // Only the normalized delay crosses the boundary (flat lowercase header map in the
        // installed SDK); a deterministic error never carries one.
        const retryAfterMs = retryable ? parseRetryAfterMs(headers?.['retry-after']) : undefined

        return {
          id: '',
          success: false,
          error: errorCode,
          retryable,
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        }
      }

      this.logger.info({ id: data?.id, to, subject }, 'Email sent successfully via Resend')

      return {
        id: data?.id || '',
        success: true,
      }
    } catch {
      const message = 'provider_failure'

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
