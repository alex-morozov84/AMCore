import { Injectable, Logger } from '@nestjs/common'

import type { EmailProvider, SendEmailParams, SendEmailResult } from '../email.types'

/**
 * Mock Email Provider
 *
 * Used in development and testing environments.
 * Logs email content to console instead of sending real emails.
 */
@Injectable()
export class MockEmailProvider implements EmailProvider {
  private readonly logger = new Logger(MockEmailProvider.name)

  async send(params: SendEmailParams): Promise<SendEmailResult> {
    const { to, subject, html, text, from, replyTo } = params

    // Log email details for debugging
    this.logger.log('📧 Email sent (MOCK)', {
      to,
      from,
      subject,
      replyTo,
      hasHtml: !!html,
      hasText: !!text,
    })

    // Log HTML preview in development
    if (process.env.NODE_ENV === 'development') {
      this.logger.debug('HTML Preview:', html.slice(0, 200) + '...')
    }

    // Simulate successful send
    return {
      id: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      success: true,
    }
  }
}
