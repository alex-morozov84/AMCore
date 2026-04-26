import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import type { EmailProvider, SendEmailParams, SendEmailResult } from '../email.types'

/**
 * Mock Email Provider
 *
 * Used in development and testing environments.
 * Logs email content to console instead of sending real emails.
 */
@Injectable()
export class MockEmailProvider implements EmailProvider {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(MockEmailProvider.name)
  }

  async send(params: SendEmailParams): Promise<SendEmailResult> {
    const { to, subject, html, text, from, replyTo } = params

    // Log email details for debugging
    this.logger.info(
      { to, from, subject, replyTo, hasHtml: !!html, hasText: !!text },
      'Email sent (MOCK)'
    )

    // Log HTML preview in development
    if (process.env.NODE_ENV === 'development') {
      this.logger.debug({ preview: html.slice(0, 200) + '...' }, 'HTML Preview')
    }

    // Simulate successful send
    return {
      id: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      success: true,
    }
  }
}
