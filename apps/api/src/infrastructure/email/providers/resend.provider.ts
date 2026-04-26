import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { Resend } from 'resend'

import type { EmailProvider, SendEmailParams, SendEmailResult } from '../email.types'

import { EnvService } from '@/env/env.service'

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
    const { to, subject, html, text, from, replyTo } = params

    try {
      const { data, error } = await this.resend.emails.send({
        from: from || this.env.get('EMAIL_FROM'),
        to: [to],
        subject,
        html,
        text,
        replyTo,
      })

      if (error) {
        this.logger.error({ to, subject, error: error.message }, 'Failed to send email via Resend')

        return {
          id: '',
          success: false,
          error: error.message,
        }
      }

      this.logger.info({ id: data?.id, to, subject }, 'Email sent successfully via Resend')

      return {
        id: data?.id || '',
        success: true,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'

      this.logger.error({ to, subject, error: message }, 'Resend API error')

      return {
        id: '',
        success: false,
        error: message,
      }
    }
  }
}
