import { Module } from '@nestjs/common'

import { EmailService } from './email.service'
import type { EmailProvider } from './email.types'
import { EmailProcessor } from './processors/email.processor'
import { MockEmailProvider } from './providers/mock.provider'
import { ResendEmailProvider } from './providers/resend.provider'

import { EnvModule } from '@/env/env.module'
import { EnvService } from '@/env/env.service'
import { QueueModule, QueueService } from '@/infrastructure/queue'

/**
 * Email Module
 *
 * Provides email sending functionality with:
 * - Template rendering (React Email)
 * - Provider abstraction (Resend/Mock)
 * - Async delivery (BullMQ)
 */
@Module({
  imports: [EnvModule, QueueModule],
  providers: [
    // Dynamic provider selection based on env
    {
      provide: 'EmailProvider',
      inject: [EnvService],
      useFactory: (env: EnvService): EmailProvider => {
        const provider = env.get('EMAIL_PROVIDER')

        switch (provider) {
          case 'resend':
            return new ResendEmailProvider(env)
          case 'mock':
          default:
            return new MockEmailProvider()
        }
      },
    },
    // Email service
    {
      provide: EmailService,
      inject: ['EmailProvider', QueueService, EnvService],
      useFactory: (emailProvider: EmailProvider, queueService: QueueService, env: EnvService) => {
        return new EmailService(emailProvider, queueService, env)
      },
    },
    // BullMQ processor
    EmailProcessor,
  ],
  exports: [EmailService],
})
export class EmailModule {}
