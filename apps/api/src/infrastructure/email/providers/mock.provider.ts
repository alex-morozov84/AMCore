import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import type { EmailProvider, SendEmailParams, SendEmailResult } from '../email.types'

/**
 * Mock Email Provider
 *
 * Used in development and testing environments. Logs metadata only: rendered
 * email bodies may contain secret token URLs and must not enter application logs.
 */
@Injectable()
export class MockEmailProvider implements EmailProvider {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(MockEmailProvider.name)
  }

  async send(params: SendEmailParams): Promise<SendEmailResult> {
    const { to, subject, html, text, from, replyTo } = params

    this.logger.info(
      { to, from, subject, replyTo, hasHtml: !!html, hasText: !!text },
      'Email sent (MOCK)'
    )

    // Simulate successful send
    return {
      id: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      success: true,
    }
  }
}
